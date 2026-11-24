import {
  inWorkspace,
  type RepositoryWorkspace,
  type WorkspaceDocument,
} from "./documents";
import type { GitHubTreeEntry } from "./githubClient";

export function workingCopyStatus(
  document: WorkspaceDocument,
  remoteEntries: Map<string, GitHubTreeEntry> | null,
): string[] {
  const origin = document.github;
  if (!origin) return ["Unpublished"];

  const status: string[] = [];
  if (document.content !== origin.baseContent) status.push("Local edits");
  if (!remoteEntries) {
    status.push("GitHub unchecked");
  } else {
    const remote = remoteEntries.get(origin.path);
    if (!remote) status.push("Not in GitHub listing");
    else if (remote.sha !== origin.blobSha || remote.mode !== origin.mode)
      status.push("GitHub differs from baseline");
  }
  return status;
}

export function repositoryFiles(
  entries: GitHubTreeEntry[],
  documents: WorkspaceDocument[],
  target: RepositoryWorkspace | null,
) {
  const remotePaths = new Set(entries.map((entry) => entry.path));
  const files = entries.filter((entry) => entry.type === "blob");
  const owned = documents.filter((item) =>
    inWorkspace(item, "repository", target),
  );
  const cachedByPath = new Map<string, WorkspaceDocument>();

  for (const item of owned) {
    const path = item.github?.path ?? item.repositoryPath;
    if (path && (item.github || !remotePaths.has(path))) {
      if (!cachedByPath.has(path)) cachedByPath.set(path, item);
      if (!item.github) {
        files.push({
          path,
          type: "blob",
          mode: "100644",
          sha: item.id,
        });
      }
    }
  }

  const listedPaths = new Set(files.map((entry) => entry.path));
  const listedDrafts = new Set(
    owned
      .filter(
        (item) =>
          !item.github &&
          item.repositoryPath &&
          !remotePaths.has(item.repositoryPath),
      )
      .map((item) => item.id),
  );
  const otherCachedFiles = owned.filter((item) =>
    item.github
      ? !listedPaths.has(item.github.path)
      : !listedDrafts.has(item.id),
  );
  const directories = new Set([""]);
  for (const entry of [...entries, ...files]) {
    if (entry.type === "tree") directories.add(entry.path);
    const parts = entry.path.split("/");
    parts.pop();
    while (parts.length) {
      directories.add(parts.join("/"));
      parts.pop();
    }
  }

  return { files, remotePaths, cachedByPath, otherCachedFiles, directories };
}
