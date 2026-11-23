# Cursor Position Sync: Feasibility Assessment & Implementation Plan

## Implemented scope: Approach A

The editor now synchronizes scrolling in both directions at top-level Markdown
block boundaries, including after view-mode changes. It does not mirror or move
cursors, selections, or focus. Lists, quotations, tables, and code fences are
treated as whole blocks. Visible blocks do not cause additional preview scrolling.
Blank lines map to the preceding block, or the first block at the document start.

Implementation uses the existing Milkdown Markdown parser and transforms to
associate source ranges with rendered blocks; splitting on blank lines would
misidentify nested lists and fenced code. Block maps are cached until the
Markdown or rendered document changes. Synchronization waits for matching content
and is deferred during IME composition. No new dependencies are required.

The estimates and illustrative API snippets below are the original proposal,
not the implemented API. Exact character-position mirroring remains out of scope.

## Executive Summary

**Feasibility: HIGHLY FEASIBLE** ✅

Syncing cursor positions between the markdown source editor (CodeMirror) and the rich preview editor (Milkdown/Crepe) is **technically achievable** and aligns well with your existing architecture. Both editors expose their cursor/selection positions through their APIs, and your markdown acts as the synchronization boundary.

---

## Current Architecture

### Editors Used
- **Source Editor**: CodeMirror 6 (via `@uiw/react-codemirror`)
- **Preview Editor**: Milkdown Crepe (via `@milkdown/crepe`)

### Synchronization Boundary
- **Markdown string** is the single source of truth
- Both editors maintain their own cursor state independently
- Changes flow through `onChange` callbacks → parent state → back to editors

### Key Insight
Both editors can track cursor position, and **there's already a listener for selection updates in the preview** (see `richEditorRuntime.ts`):

```typescript
listener.selectionUpdated((ctx, selection) => {
  editorDiagnostics.record("preview-selection", {
    from: selection.from,
    to: selection.to,
    // ...
  });
});
```

---

## Feasibility Analysis

### ✅ Strengths

1. **Selection APIs are available**
   - CodeMirror exposes cursor position via `state.selection.from/to`
   - Milkdown exposes selection via `editorViewCtx` and selection listeners
   - Both provide programmatic cursor control

2. **Existing synchronization mechanism**
   - Markdown is already synced bidirectionally
   - The sync framework handles origin tracking (`origin: "source" | "rich"`)
   - Cursor state can follow the same pattern

3. **React component structure supports it**
   - `MarkdownSurface` already manages both editors
   - Parent state can coordinate cursor position just like markdown
   - View mode switching (split/source/rendered) provides UX boundaries

4. **No external dependencies needed**
   - Both CodeMirror and Milkdown APIs are already in use
   - No new libraries required

### ⚠️ Challenges

1. **Character offset mapping complexity**
   - **THE MAIN CHALLENGE**: Markdown source offsets don't directly map to preview offsets
   - Example: `**bold**` (8 chars in source) renders as "bold" (4 chars in preview)
   - Need a mapping strategy: either
     - Character-to-rendered-position mapping
     - AST-based position tracking
     - Heuristic scrolling instead of precise cursor sync

2. **Rich text complexity**
   - Milkdown's internal representation differs from markdown
   - Selection may span formatted nodes differently than source

3. **Scroll vs. cursor semantics**
   - User might want:
     - **Scroll preview to show editing location** (simpler)
     - **Exact cursor position mirroring** (harder, requires mapping)
   - These have different implementation complexity

4. **Split view timing**
   - Both editors exist simultaneously → need to sync both ways
   - Performance: frequent cursor updates could be expensive
   - Debouncing recommended

5. **View mode switching**
   - In "source" or "rendered" mode, only one editor is visible
   - Cursor sync still possible but different UX implications
   - In split view, users can see both cursors at once

---

## Implementation Approaches

### Approach A: Scroll-to-Current-Block (RECOMMENDED - 2-3 days)

**Concept**: Scroll the preview to show the markdown block containing the editing cursor, without worrying about exact character positions.

**How it works**:
1. Track cursor position in source editor
2. Determine which markdown block contains the cursor (paragraph, heading, list item, code block, etc.)
3. Use block boundaries to scroll the preview to that block
4. Visual indicator shows "you're editing this block"

**Pros**:
- Simpler implementation
- No character mapping needed
- Good UX: "here's what you're editing"
- Avoids most offset complexity

**Cons**:
- Doesn't show exact cursor position in preview
- Less precise than true cursor sync

**Complexity**: Low
**Timeline**: 2-3 days
**Code Changes**: ~200-300 lines

---

### Approach B: AST-Based Position Mapping (RECOMMENDED EVENTUALLY - 1-2 weeks)

**Concept**: Build a mapping between markdown AST nodes and their rendered positions, track cursor through the AST.

**How it works**:
1. Parse markdown to AST (Lezer already does this in CodeMirror)
2. Build node ↔ character position map
3. When cursor moves in source: find AST node → find equivalent in Milkdown → sync position
4. Use `editorViewCtx` to set cursor in Milkdown directly

**Pros**:
- True cursor/selection synchronization
- Handles complex formatting correctly
- Professional UX

**Cons**:
- Significantly more complex
- Requires deep understanding of both AST structures
- More potential for bugs
- Performance: position mapping on every cursor change

**Complexity**: High
**Timeline**: 1-2 weeks
**Code Changes**: ~500-800 lines

---

### Approach C: Character Offset Transformation (NOT RECOMMENDED)

**Concept**: Try to map character offsets directly between markdown and rendered view.

**Why not**: This is fundamentally flawed because:
- Markdown syntax characters disappear in rendering (`**bold**` → `bold`)
- Complex nesting breaks simple math
- Block transformations (lists, indentation) invalidate offsets
- Maintenance nightmare

---

## Recommended Implementation Plan

### Phase 1: Foundation (Days 1-2)

1. **Create cursor state management**
   - Add `cursorPosition` to `MarkdownSurface` component state
   - Track cursor in source editor via CodeMirror's `selection` event
   - Expose cursor position from Milkdown via selection listener (already there)

2. **Add cursor position extraction**
   - Create `useCursorPosition.ts` hook
   - Extract from CodeMirror: `state.selection.from`
   - Extract from Milkdown: `ctx.get(editorViewCtx).state.selection.from`

3. **Create markdown block analyzer**
   - Add `markdownBlocks.ts` utility
   - Parse markdown to find block boundaries (paragraphs, headings, lists, code blocks)
   - Function: `findBlockAtCursor(markdown: string, cursorPos: number): Block`
   - Function: `getBlockStartOffset(markdown: string, blockIndex: number): number`

### Phase 2: Scroll Synchronization (Days 2-3)

1. **Link source cursor to preview scroll**
   - When source cursor changes:
     - Find block at cursor
     - Find that block's DOM element in preview
     - Scroll preview container to show it
     - Use `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`

2. **Link preview cursor to source scroll**
   - When preview cursor changes:
     - Find block at cursor
     - Find approximate position in source
     - Scroll source to show it

3. **Add visual feedback**
   - Optional: highlight the current block in preview
   - Optional: show cursor indicator in source when editing preview

4. **Handle view mode changes**
   - Preserve editor state when toggling between split/source/rendered
   - Sync cursor when switching views

### Phase 3: Testing & Refinement (Days 3-4)

1. Write tests for `markdownBlocks.ts`
   - Edge cases: empty blocks, nested lists, code blocks with markdown-like content
   - Boundary conditions: cursor at start/end

2. Integration tests
   - Test cursor sync across view changes
   - Test with different markdown structures
   - Performance test: cursor updates while typing

3. User testing scenarios
   - Split view: edit source, preview scrolls to block
   - Switch views: edit in source, switch to rendered → preview at right position
   - Complex documents: nested lists, tables, code blocks

---

## Code Structure Changes

### New Files

```
src/
  cursorSync.ts           # Core cursor tracking utilities
  markdownBlocks.ts       # Markdown block boundary detection
  useCursorPosition.ts    # React hook for cursor management
```

### Modified Files

```
src/MarkdownSurface.tsx   # Add cursor tracking + scroll sync
src/richEditorRuntime.ts  # Expose selection events (mostly ready)
```

### Estimated Lines of Code
- `cursorSync.ts`: ~100-150 lines
- `markdownBlocks.ts`: ~150-200 lines
- `useCursorPosition.ts`: ~80-120 lines
- `MarkdownSurface.tsx`: ~100-150 lines of changes
- Tests: ~300-400 lines

**Total**: ~700-900 lines of new/modified code

---

## Technical Details

### CodeMirror Cursor Access

```typescript
// Get cursor position
const editorView = /* CodeMirror EditorView instance */;
const cursorPos = editorView.state.selection.main.head;

// Listen to cursor changes
editorView.dispatch({
  selection: { anchor: pos, head: pos }
});
```

### Milkdown/Crepe Cursor Access

```typescript
// Get cursor position (already in your code)
crepe.on((listener) => {
  listener.selectionUpdated((ctx, selection) => {
    const pos = selection.from;
  });
});

// Set cursor position
crepe.editor.action((ctx) => {
  const view = ctx.get(editorViewCtx);
  view.dispatch({
    selection: { anchor: pos, head: pos }
  });
});
```

### Markdown Block Detection

```typescript
// Pseudo-code for block finder
function findBlockAtCursor(markdown: string, cursorPos: number): Block {
  // Split by block boundaries (double newline, heading markers, etc.)
  // Find which block contains cursorPos
  // Return block metadata: start, end, type, content
}
```

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Performance degrades with large docs | Medium | Medium | Debounce cursor updates; profile before shipping |
| Offset mapping bugs | High | Medium | Extensive test coverage; start with scroll approach |
| Sync breaks on edge cases (tables, code) | Medium | High | Test thoroughly; handle as known limitations initially |
| View mode switching loses cursor | Low | Low | Preserve cursor state in refs; restore on view change |
| User confusion about multiple cursors | Low | Low | Clear visual feedback; document in help |

---

## Success Criteria

✅ **Phase 1 Complete**
- Cursor position can be read from both editors
- Block boundaries are correctly detected

✅ **Phase 2 Complete**
- When editing source: preview auto-scrolls to current block
- When editing preview: source auto-scrolls to current block
- Works across all three view modes
- No performance degradation with 10,000+ character documents

✅ **Phase 3 Complete**
- All tests pass
- No regression in existing functionality
- Smooth user experience in split view

---

## Future Enhancements (Out of Scope)

1. **True cursor position mirroring**
   - Implement AST-based mapping (Approach B above)
   - Show exact cursor position in both views

2. **Collaborative cursors**
   - Show other users' cursors if added to multi-user mode

3. **Selection highlighting**
   - Highlight selected text across both editors

4. **Bracket matching**
   - Show matching markdown syntax brackets

---

## Recommendation

**Start with Approach A (Scroll-to-Block)** because:

1. ✅ Delivers immediate value with modest effort
2. ✅ Aligns with your "sync boundary is markdown" philosophy
3. ✅ Low risk; failures are graceful
4. ✅ Provides foundation for Approach B later
5. ✅ Users immediately see "here's what I'm editing" feedback

Implement in **2-3 sprints** with this priority:
1. Block boundary detection
2. Source → Preview scroll sync
3. Preview → Source scroll sync
4. Visual feedback polish

---

## Questions for You

1. **Split view UX**: When both editors are visible, would you want:
   - Both cursors shown visually? (harder)
   - Just scroll sync? (current plan)
   - Highlight current block in preview? (nice-to-have)

2. **Selection sync**: Should we sync just cursor position, or full selection (multi-character)?

3. **Scroll behavior**: Smooth scroll or instant? Snap to center or top of viewport?

4. **Performance**: Document size you care about? (most editing is <10K chars)

5. **Priority**: Nice-to-have feature or high priority? (affects timeline)
