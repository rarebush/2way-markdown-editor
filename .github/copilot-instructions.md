# Project guidance

- Keep Markdown text as the synchronization boundary between CodeMirror and Milkdown.
- Preserve both editor instances across view-mode changes to avoid losing selection and cursor state.
- Keep document persistence browser-local in IndexedDB; imports create new documents and must not overwrite existing drafts.
- Verify changes with `npm test`, `npm run lint`, and `npm run build`.

## Hard Rule: Always Push to Origin

**MANDATORY**: Every commit to `main` must be pushed to `origin` without exception. No partial pushes, no skipping, no deferring.

```bash
git push origin main
```

Verify the push succeeded by checking the remote:
```bash
git log origin/main --oneline -1
```

Failure to push blocks GitHub Pages deployment and creates drift between local and deployed versions. If push fails, fix the issue before proceeding with other work.