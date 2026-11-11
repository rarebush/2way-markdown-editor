# Deployment and Remote Sync Policy

## Repository Remotes

This repository is synced across **two remotes** that must remain in perfect sync:

| Remote | URL | Owner | Purpose |
|--------|-----|-------|---------|
| `origin` | `https://github.com/sallen-wiley/2way-markdown-editor.git` | sallen-wiley (you) | Primary upstream with push access |
| `rarebush` | `https://github.com/rarebush/2way-markdown-editor.git` | rarebush account | Mirror/secondary (fetch-only for sallen-wiley) |

## Branches Managed

The following branches are maintained across all remotes:

- **`main`** ← Primary production branch (both remotes)
- `copilot/confirm-zoom-issue-and-solution` (origin only)
- `copilot/modify-markdown-files-in-repo` (origin only)

## Hard Rule: All Accessible Remotes Stay In Sync

**MANDATORY ENFORCEMENT**: After every commit or merge to `main` or any tracked branch, you MUST:

1. **Push to all remotes you have write access to**
   ```bash
   git push origin main
   ```
   (rarebush is fetch-only; the rarebush account owner must sync their remote)

2. **Verify origin is up-to-date**
   ```bash
   git log origin/main --oneline -1
   ```

3. **No exceptions** — Every single push to `main` must go to `origin` without fail
   - Incomplete pushes cause deployment delays
   - Stale origin blocks CI/CD pipelines (GitHub Pages deployment depends on origin/main)
   - rarebush will be out of sync until its owner pulls from origin

## Access Model

- **sallen-wiley (you)**: Full push access to `origin` only
- **rarebush account**: Owns its own fork; must pull from origin to stay in sync
- **GitHub Pages**: Deploys from `origin/main` only

**Note**: If you need rarebush to stay in sync automatically, either:
  - Have the rarebush account maintainer set up GitHub Actions to pull from origin, OR
  - Request push access to rarebush and then apply the multi-remote sync rule

## GitHub Pages Deployment

- Deployment is automated via `.github/workflows/pages.yml`
- Triggered on `push` to `main` branch on **`origin` only** (primary)
- **Both remotes must stay in sync** so either can serve as a recovery point
- If deployment fails, verify both remotes are in sync before retrying

## How to Add or Remove Remotes

**Adding a new remote:**
```bash
git remote add <name> <url>
git fetch <name>
git push <name> main
```

**Removing a remote:**
```bash
git remote remove <name>
```
Then update this file to reflect the change.

## Breach Protocol

If remotes get out of sync:

1. Fetch all remotes: `git fetch --all`
2. Check differences: `git log origin/main..rarebush/main`
3. Force align the lagging remote:
   ```bash
   git push --force-with-lease rarebush main
   ```
4. Verify: Both remotes should show the same commit
5. Document in commit message or issue that sync was required
