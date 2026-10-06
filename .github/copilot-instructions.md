# Project guidance

- Keep Markdown text as the synchronization boundary between CodeMirror and Milkdown.
- Preserve both editor instances across view-mode changes to avoid losing selection and cursor state.
- Keep document persistence browser-local in IndexedDB; imports create new documents and must not overwrite existing drafts.
- Verify changes with `npm test`, `npm run lint`, and `npm run build`.