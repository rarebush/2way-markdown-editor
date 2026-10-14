import type {
  GitHubOrigin,
  GitHubPending,
  WorkspaceDocument,
} from "./documents";
import {
  GitHubClient,
  GitHubError,
  validateMarkdownPath,
  encodeMarkdown,
  type GitHubTarget,
  type GitHubCommit,
  type GitHubTreeChange,
} from "./githubClient";

export type GitHubOperation = GitHubPending["operation"];

export function repositoryFilename(title: string): string {
  const safeTitle = [...title.trim().replace(/\.(md|markdown|mdown|mkd)$/i, "")]
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? "-"
        : character,
    )
    .join("")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^[.-]+|[. -]+$/g, "");
  return `${safeTitle || "document"}.md`;
}

export type GitHubReview = {
  documentId: string;
  operation: GitHubOperation;
  head: GitHubCommit;
  origin: GitHubOrigin;
  oldPath: string;
  before: string;
  after: string;
};

export async function prepareGitHubChange(
  client: GitHubClient,
  document: WorkspaceDocument,
  operation: GitHubOperation,
  target: GitHubTarget,
  destination?: string,
): Promise<GitHubReview> {
  if (document.githubPending)
    throw new GitHubError(
      "Check the previous commit's outcome before making another change.",
    );
  const repository = await client.repository(target);
  if (repository.id !== target.repositoryId || repository.archived)
    throw new GitHubError(
      "The repository has changed or is archived. Select it again.",
    );
  const head = await client.head(target);
  const base = document.github;
  if (
    operation !== "create" &&
    (!base ||
      base.repositoryId !== target.repositoryId ||
      base.owner !== target.owner ||
      base.repo !== target.repo ||
      base.branch !== target.branch)
  ) {
    throw new GitHubError(
      "This draft belongs to a different repository or branch.",
    );
  }
  const oldPath =
    operation === "create" ? "" : validateMarkdownPath(base!.path);
  let source: GitHubOrigin | undefined;
  if (oldPath) {
    source = await client.open(target, oldPath, head);
    if (source.blobSha !== base!.blobSha || source.mode !== base!.mode)
      throw new GitHubError(
        "The remote file changed. Compare with the latest version before committing.",
        409,
      );
  }
  const path = validateMarkdownPath(
    operation === "create" || operation === "move"
      ? (destination ?? "")
      : oldPath,
  );
  if (operation === "create" || operation === "move") {
    if (await client.entry(target, head.tree.sha, path))
      throw new GitHubError(
        `A file already exists at ${path}. Choose another directory or filename; the existing file will not be overwritten.`,
        409,
      );
  }
  const before = source?.baseContent ?? "";
  const after =
    operation === "delete"
      ? ""
      : operation === "move"
        ? before
        : document.content;
  encodeMarkdown(after);
  if (operation === "update" && before === after)
    throw new GitHubError("There are no Markdown changes to commit.");
  return {
    documentId: document.id,
    operation,
    head,
    oldPath,
    before,
    after,
    origin: {
      ...target,
      path,
      blobSha: source?.blobSha ?? "pending",
      commitSha: head.sha,
      baseContent: after,
      mode: source?.mode ?? "100644",
    },
  };
}

export async function buildGitHubCommit(
  client: GitHubClient,
  review: GitHubReview,
  message: string,
): Promise<GitHubPending> {
  if (!message.trim()) throw new GitHubError("Enter a commit message.");
  const { origin, operation } = review;
  const blobSha =
    operation === "create" || operation === "update"
      ? (await client.createBlob(origin, review.after)).sha
      : origin.blobSha;
  const changes: GitHubTreeChange[] =
    operation === "delete"
      ? []
      : [{ path: origin.path, mode: origin.mode, type: "blob", sha: blobSha }];
  if (operation === "delete" || operation === "move")
    changes.push({
      path: review.oldPath,
      mode: origin.mode,
      type: "blob",
      sha: null,
    });
  const tree = await client.createTree(origin, review.head.tree.sha, changes);
  const commit = await client.createCommit(
    origin,
    review.head.sha,
    tree.sha,
    message.trim(),
  );
  return {
    candidateSha: commit.sha,
    previousHead: review.head.sha,
    operation,
    origin: { ...origin, blobSha, commitSha: commit.sha },
  };
}

export async function checkGitHubCommit(
  client: GitHubClient,
  pending: GitHubPending,
): Promise<"published" | "not-published" | "unknown"> {
  const head = await client.head(pending.origin);
  if (head.sha === pending.candidateSha) return "published";
  if (head.sha === pending.previousHead) return "not-published";
  const comparison = await client.compare(
    pending.origin,
    pending.candidateSha,
    head.sha,
  );
  return comparison.status === "ahead" || comparison.status === "identical"
    ? "published"
    : "unknown";
}

export function finishGitHubCommit(
  document: WorkspaceDocument,
  pending: GitHubPending,
): WorkspaceDocument {
  const { githubPending: _pending, github: _origin, ...local } = document;
  return {
    ...local,
    ...(pending.operation === "move"
      ? {
          name:
            pending.origin.path
              .split("/")
              .pop()
              ?.replace(/\.(md|markdown|mdown|mkd)$/i, "") || local.name,
        }
      : {}),
    repository: {
      repositoryId: pending.origin.repositoryId,
      owner: pending.origin.owner,
      repo: pending.origin.repo,
      branch: pending.origin.branch,
    },
    repositoryPath: pending.origin.path,
    ...(pending.operation === "delete" ? {} : { github: pending.origin }),
    updatedAt: Date.now(),
  };
}
