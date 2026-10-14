# Draft. Markdown workspace

A browser-based Markdown editor with editable source and rich-text views. The two surfaces stay synchronized through Markdown serialization, including GitHub Flavored Markdown tables and task lists.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The app starts in split view and saves multiple named documents to IndexedDB in the current browser. Select files using the left-rail navigation. **Add file** and **Import Markdown** are together at the right of the rail toolbar; **Export Markdown** is beside the active file's rename/delete actions.

## GitHub Pages

This project is published from two public repositories:

- Canonical: <https://github.com/sallen-wiley/2way-markdown-editor>, deployed at <https://sallen-wiley.github.io/2way-markdown-editor/>.
- Mirror: <https://github.com/rarebush/2way-markdown-editor>, deployed at <https://rarebush.github.io/2way-markdown-editor/>.

Each repository deploys its `main` branch to GitHub Pages through the same Actions workflow. Push changes to both repositories to keep the mirror synchronized.

## GitHub files

Switch to **Repository**, then choose **Connect GitHub** to connect with a personal access token (PAT). Once connected, the action is labelled **GitHub settings**. Local does not show a GitHub connection action. This works directly from GitHub Pages without a backend or an OAuth application secret.

1. [Create a fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Draft&contents=write&expires_in=30) with an expiration, the appropriate resource owner, and **Only select repositories**. Grant **Contents: read and write**; Metadata read access is included by GitHub. No account, administration, pull-request, or workflow permissions are needed.
2. Paste the token into the app's password field, not into chat or a bug report. The app keeps it only in memory. Reloading or disconnecting clears it; disconnecting does not revoke it on GitHub. Revoke an unneeded token in GitHub settings.
3. Browse repositories, or enter a `https://github.com/owner/repo` URL or `owner/repo`. Selecting a repository closes the picker and displays every supported Markdown path in a persistent, collapsible folder tree beside the editors. Select an existing branch in the sidebar and click any file to edit it directly. Content is fetched only when first opened, not downloaded for the whole repository. Reopening a cached file immediately selects its local draft without downloading or overwriting its edits. The repository filter applies to loaded results; use **Load repositories** or **Load branches** for more pages.
4. Switch between **Local** and **Repository** workspaces. In Local, use a file's **Move to repository** action beside its title, choose the destination directory (or a new directory), and review the filename translated from its title. Review the Markdown diff and confirm **Move to repository** to publish the commit. The same file then leaves Local and belongs to the selected repo; no duplicate local-space file is created. Subsequent repo edits use **Commit changes**. There is no remote autosave.

**Sync with GitHub** fetches the current remote source. **Ignore GitHub version** closes the dialog without changing your draft or its comparison baseline. **Save draft as Local copy** creates a new independent Local document containing your current draft, not the remote content. **Discard draft and use GitHub version** replaces your draft with the checked remote content. **Review and commit draft** accepts the checked remote version as the baseline and opens a commit review; it does not publish until you confirm **Commit to GitHub**. This explicitly replaces remote content with your draft rather than merging remote edits. Identical content shows a no-changes result instead of an empty diff.

There are two distinct workspaces, not one mixed file list. Local contains only local-owned files. Repository contains the selected repository/branch's files and their browser-local working copies; those copies do not appear in Local, including retained copies of remotely deleted files. The rail is the file selector for the current workspace; there is no duplicate global-header dropdown. Selecting a different repo or branch never moves or matches Local files automatically.

Local-to-repo moves are explicit, never name-based reconciliation. Whitespace and unsupported filename characters in a local title become hyphens and a `.md` extension is added; the destination filename is visible and can be changed before review. An existing file at the exact destination triggers a warning and blocks the move, even if its content is identical. Choose another directory or filename rather than overwrite it. GitHub paths are case-sensitive. Cancelled or rejected moves retain the original Local file; uncertain outcomes must be checked before retrying. Successful moves preserve any edits made after the reviewed snapshot as uncommitted repo working-copy edits.

Only repository files already opened or created as working drafts are available offline. Cached working copies remain inside Repository after reload or disconnect; reconnect to list/open uncached files or switch the selected repository/branch.

**Add file** and **Import Markdown** act on the selected workspace. In Local, they create new local files without overwriting existing drafts. In Repository, select a repository/branch first, then choose a repository-relative Markdown path in the creation/import dialog. Existing paths warn and block creation; drafts with the same title in Local are not matched or moved. The new repo-owned working file appears in the tree immediately and remains outside Local, including before publication. Use **Create on GitHub**, review the destination and Markdown diff, and explicitly confirm to publish. Adding/importing never commits automatically. Repository exports use the file's chosen repository filename.

GitHub settings are limited to connection and repository selection. Every file-specific action starts beside the active file title; there is no "Linked file" section in settings. File comparison, path entry, diff review, and commit confirmation use a separate file-actions dialog.

| Title action                      | Purpose                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| Export Markdown                   | Download the current working content. Does not change GitHub.                                |
| Rename document / Delete document | For Local files, change the local title or delete the local document.                        |
| Rename draft                      | For an unpublished repository draft, edit its title/path locally; publish separately.        |
| Move to repository                | Publish a Local file at an explicitly chosen repo path and transfer its workspace ownership. |
| Create on GitHub                  | Publish an unpublished repo working draft after reviewing its path and content.              |
| Sync with GitHub                  | Check the remote version, ignore it, use it, save a Local copy, or review a draft commit.    |
| Commit changes                    | Check for newer remote content, then review and confirm a commit. Conflicts open Sync.       |
| Rename on GitHub                  | Review and commit a remote path change atomically. Content edits remain uncommitted.         |
| Delete file                       | Remove only the browser copy, or review deletion from GitHub and this browser together.      |
| Discard changes                   | Restore the last checked version, or discard edits and fetch the latest GitHub version.      |
| Check outcome                     | Verify an unconfirmed commit before allowing further changes.                                |

Published repository files have reviewed GitHub rename/delete actions, not ambiguous local-only equivalents. Remote writes are disabled while disconnected or while a commit outcome is unresolved. Remote moves/renames are one atomic commit, check the source revision and destination, and update the displayed filename only after success; any local content edits remain uncommitted. **Delete file** offers browser-only removal with local confirmation, or reviewed remote deletion followed by browser-copy removal only after publication is confirmed. Rejected or uncertain remote deletion retains the working copy. **Discard changes** asks you to choose a restore source before removing edits; the last checked version is available offline. Export always downloads the current editor content, including uncommitted edits. Local persistence remains automatic; committing is the explicit publish step, with no separate push action.

The app checks the affected file revision and destination before writing and never force-pushes. Remote conflicts and competing branch updates require another comparison/review. A lost publication response leaves a token-free recovery record with the candidate commit SHA. Use **Check outcome** after reconnecting before attempting another write. If branch history has diverged and the outcome cannot be verified, the draft remains blocked from further remote writes; the candidate link lets you inspect its history on GitHub. Local persistence errors also retain drafts and recovery information; do not close the page while work is not saved locally.

### Access and limits

- Fine-grained tokens cover one resource owner. Switching between personal and organization repositories can require a different token. Organizations may require approval or block tokens; outside/repository collaborator scenarios have [fine-grained PAT limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations). Classic tokens can work with the same connection flow but have broader access and are not the recommended default.
- Repository visibility does not guarantee write access. Protected branches, required pull requests, signing requirements, and other rules can reject direct commits. This version does not create branches, pull requests, or initialize empty repositories.
- GitHub.com only. Regular UTF-8 `.md`, `.markdown`, `.mdown`, and `.mkd` files up to 1 MiB are supported. Symlinks, submodules, non-Markdown files, and `.github/workflows` writes are excluded. File modes, BOM, line endings, and trailing newlines are preserved by transport; rich-text editing still has the normalization limitations below.
- Imports, exports, and editing continue to work offline. Private repository drafts and their base Markdown remain in IndexedDB after disconnecting. Delete local drafts separately on shared devices. Browser storage is tied to the origin/profile, not to a GitHub login; Pages sites under the same host share that origin. In-memory token storage reduces persistent exposure but cannot protect a token from compromised scripts running in the page.
- Image/asset upload and authenticated private-image fetching are not included. The app does not forward the PAT to image or download URLs. Source diffs render as text rather than HTML. Review the diff before committing rich-text edits, especially for unsupported Markdown syntax.

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
window.draftDiagnostics.start();
```

Use the editor normally. As soon as you notice a jump, return to the Console and run:

```js
window.draftDiagnostics.mark();
window.draftDiagnostics.stop();
copy(window.draftDiagnostics.export());
```

Paste the copied JSON into a bug report or share it for debugging. `copy()` is a developer-tools Console helper, not an app function; if unavailable, run `window.draftDiagnostics.export()` and copy its returned string.

Diagnostics are off by default and kept only in memory, with the latest 1,000 events retained. Reloading clears the report; starting again clears the previous session. Reports contain timestamps relative to recording start, selection positions, event types, content lengths, and document-replacement events. They exclude document text, names, identifiers, and typed characters, and are not uploaded automatically.

Include which pane you were typing in, whether you were in a table, and what you did immediately before the jump. A `replace-all-before` / `replace-all-after` pair that changes selection without a pointer event would support the synchronization hypothesis; a jump without replacement would point to another editor interaction.

## Checks

Document collection, workspace selection, autosave, and durable draft updates are
owned by [`useDocumentWorkspace`](./src/useDocumentWorkspace.ts). The app owns
dialogs and editor presentation; IndexedDB access stays in
[`documents`](./src/documents.ts). Durable GitHub metadata updates flush only the
affected document through the per-document save scheduler. Pending saves for
other drafts continue independently.

Repository membership is shared through `inWorkspace` in
[`documents`](./src/documents.ts). [`repositoryFiles`](./src/repositoryFiles.ts)
derives the remote/draft listing, cached-file lookup, and destination directories
using path indexes. Missing remote files retain their cached working copies;
unpublished drafts never shadow existing remote paths.

[`AppGitHub.integration.test.tsx`](./src/AppGitHub.integration.test.tsx) exercises
the real app, GitHub workspace, sync logic, and browser-local persistence together.
It covers offline draft restoration, reviewed Local-to-repository moves, and
publication recovery across reloads without duplicate commits. GitHub HTTP
responses and the heavyweight editor are mocked; real GitHub permissions and
editor caret behaviour are outside these tests.

```sh
npm test
npm run lint
npm run build
```

Documents remain in the browser profile where they were created. Export important work as a `.md` file for backup or transfer.
