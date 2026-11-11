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

## Hard Rule: sallen-wiley Always Pushes to Origin

**MANDATORY ENFORCEMENT**: After every commit or merge to `main` or any tracked branch:

1. **sallen-wiley must push to origin**
   ```bash
   git push origin main
   ```
   This is non-negotiable. Every commit to `main` must reach `origin/main` without exception.

2. **Verify origin is up-to-date**
   ```bash
   git log origin/main --oneline -1
   ```

3. **Why this matters**:
   - GitHub Pages deployment depends on `origin/main` being current
   - Stale origin blocks CI/CD pipelines
   - This is the single point of truth for the project

## Remote Sync Responsibility Model

| Account | Remote | Responsibility |
|---------|--------|-----------------|
| **sallen-wiley** (you) | `origin` | **Push immediately after every commit to `main`** — No exceptions |
| **rarebush** | `rarebush` | **Pull from origin to stay in sync** — rarebush account owner is responsible for this |
| **GitHub Pages** | origin | Deployment automation watches `origin/main` only |

**Sync Flow:**
```
sallen-wiley commits → git push origin main → GitHub Pages auto-deploys
                    ↓
            rarebush account pulls from origin to catch up
```

Your job: Always push to origin.  
Rarebush account's job: Pull from origin to stay current.

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
