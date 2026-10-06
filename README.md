# Draft. Markdown workspace

A browser-based Markdown editor with editable source and rich-text views. The two surfaces stay synchronized through Markdown serialization, including GitHub Flavored Markdown tables and task lists.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The app starts in split view and saves multiple named documents to IndexedDB in the current browser. Markdown files can be imported as new documents or exported from the active document.

## GitHub Pages

This project is published from two public repositories:

- Canonical: <https://github.com/sallen-wiley/2way-markdown-editor>, deployed at <https://sallen-wiley.github.io/2way-markdown-editor/>.
- Mirror: <https://github.com/rarebush/2way-markdown-editor>, deployed at <https://rarebush.github.io/2way-markdown-editor/>.

Each repository deploys its `main` branch to GitHub Pages through the same Actions workflow. Push changes to both repositories to keep the mirror synchronized.

## Views and editing

- Markdown only: edit the source with syntax highlighting and line numbers.
- Split view: edit Markdown and the formatted document side by side.
- Rendered only: edit the formatted document directly.
- The rich editor supports common Markdown and GFM constructs, including tables, task lists, strikethrough, links, quotations, and fenced code blocks.

## Markdown preservation

The Markdown pane and rich editor currently synchronize by parsing and serializing the whole document. The rich editor can normalize supported syntax, and it may change or drop constructs it does not represent when you edit in the rendered pane. Exact source formatting and arbitrary Markdown extensions are not guaranteed to round-trip unchanged. Keep an exported `.md` backup before using the rich editor on documents with custom syntax.

Before opening the tool up to a wider range of users, revisit this limitation:

- Define the supported Markdown dialect and how user extensions are identified.
- Add round-trip fixtures for standard Markdown, GFM, and representative custom syntax.
- Preserve unsupported constructs as untouched source, or clearly report when a rich edit could change them.

## Capturing caret diagnostics

To investigate an unexpected caret jump, open the browser developer tools Console and run:

```js
window.draftDiagnostics.start()
```

Use the editor normally. As soon as you notice a jump, return to the Console and run:

```js
window.draftDiagnostics.mark()
window.draftDiagnostics.stop()
copy(window.draftDiagnostics.export())
```

Paste the copied JSON into a bug report or share it for debugging. `copy()` is a developer-tools Console helper, not an app function; if unavailable, run `window.draftDiagnostics.export()` and copy its returned string.

Diagnostics are off by default and kept only in memory, with the latest 1,000 events retained. Reloading clears the report; starting again clears the previous session. Reports contain timestamps relative to recording start, selection positions, event types, content lengths, and document-replacement events. They exclude document text, names, identifiers, and typed characters, and are not uploaded automatically.

Include which pane you were typing in, whether you were in a table, and what you did immediately before the jump. A `replace-all-before` / `replace-all-after` pair that changes selection without a pointer event would support the synchronization hypothesis; a jump without replacement would point to another editor interaction.

## Checks

```sh
npm test
npm run lint
npm run build
```

Documents remain in the browser profile where they were created. Export important work as a `.md` file for backup or transfer.
