# Project guidance

- Keep Markdown text as the synchronization boundary between CodeMirror and Milkdown.
- Preserve both editor instances across view-mode changes to avoid losing selection and cursor state.
- Keep document persistence browser-local in IndexedDB; imports create new documents and must not overwrite existing drafts.
- Verify changes with `npm test`, `npm run lint`, and `npm run build`.

## Hard Rule: Always Push to Origin

**MANDATORY**: Every commit to `main` must be pushed to `origin` without exception. This is the sallen-wiley account's responsibility.

```bash
git push origin main
```

Verify the push succeeded:
```bash
git log origin/main --oneline -1
```

**Why this is critical:**
- GitHub Pages deployment watches `origin/main` only
- Without pushing to origin, your local changes never reach production
- Failure to push blocks CI/CD pipelines and leaves rarebush out of sync

**Sync model:**
- sallen-wiley: Push to origin after every `main` commit (mandatory, no exceptions)
- rarebush account: Pulls from origin to stay current (rarebush account's responsibility)
- GitHub Pages: Auto-deploys from origin/main