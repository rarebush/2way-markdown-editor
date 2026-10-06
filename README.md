# Draft. Markdown workspace

A browser-based Markdown editor with editable source and rich-text views. The two surfaces stay synchronized through Markdown serialization, including GitHub Flavored Markdown tables and task lists.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The app starts in split view and saves multiple named documents to IndexedDB in the current browser. Markdown files can be imported as new documents or exported from the active document.

## GitHub Pages

The site is configured for the repository Pages URL: <https://sallen-wiley.github.io/2way-markdown-editor/>. Pushes to `main` run the checks and build, then deploy `dist` through GitHub Actions. In the repository settings, set Pages to use GitHub Actions as its deployment source.

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

## Checks

```sh
npm test
npm run lint
npm run build
```

Documents remain in the browser profile where they were created. Export important work as a `.md` file for backup or transfer.
