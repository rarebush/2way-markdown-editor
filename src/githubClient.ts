import type { GitHubOrigin } from "./documents";

export const MAX_MARKDOWN_BYTES = 1024 * 1024;
const apiOrigin = "https://api.github.com";
const segment = encodeURIComponent;

export type GitHubRepository = {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  archived: boolean;
};
export type GitHubTarget = {
  repositoryId: number;
  owner: string;
  repo: string;
  branch: string;
};
export type GitHubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
};
export type GitHubTreeChange = {
  path: string;
  mode: string;
  type: "blob";
  sha: string | null;
};
export type GitHubCommit = { sha: string; tree: { sha: string } };

export class GitHubError extends Error {
  readonly status: number;
  readonly uncertain: boolean;
  readonly retryAt?: number;

  constructor(
    message: string,
    status = 0,
    uncertain = false,
    retryAt?: number,
  ) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.uncertain = uncertain;
    this.retryAt = retryAt;
  }
}

export function parseRepository(input: string): {
  owner: string;
  repo: string;
} {
  let parts: string[];
  if (input.trim().startsWith("https://")) {
    const url = new URL(input.trim());
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new GitHubError("Enter a github.com repository URL or owner/name.");
    }
    parts = url.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");
  } else {
    parts = input.trim().split("/");
  }
  const [owner, rawRepo] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (
    parts.length !== 2 ||
    !/^[a-z\d][a-z\d-]*$/i.test(owner ?? "") ||
    !/^[a-z\d_.-]+$/i.test(repo ?? "") ||
    repo === "." ||
    repo === ".."
  ) {
    throw new GitHubError("Enter a github.com repository URL or owner/name.");
  }
  return { owner, repo };
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

export function validateMarkdownPath(path: string): string {
  if (
    !isMarkdownPath(path) ||
    path.includes("\\") ||
    [...path].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.toLowerCase().startsWith(".github/workflows/")
  ) {
    throw new GitHubError(
      "Use a repository-relative Markdown path without traversal or workflow files.",
    );
  }
  return path;
}

export function encodeMarkdown(content: string): string {
  const bytes = new TextEncoder().encode(content);
  if (bytes.length > MAX_MARKDOWN_BYTES)
    throw new GitHubError("Markdown files must be 1 MiB or smaller.");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeMarkdown(content: string): string {
  let bytes: Uint8Array;
  try {
    const binary = atob(content.replace(/\s/g, ""));
    if (binary.length > MAX_MARKDOWN_BYTES)
      throw new GitHubError("Markdown files must be 1 MiB or smaller.");
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    throw new GitHubError("This file is not valid UTF-8 Markdown.");
  }
}

export class GitHubClient {
  readonly #token: string;
  private readonly signal?: AbortSignal;

  constructor(token: string, signal?: AbortSignal) {
    this.#token = token;
    this.signal = signal;
  }

  private async request<ResponseType>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<ResponseType> {
    const url = new URL(path, apiOrigin);
    if (url.origin !== apiOrigin || !path.startsWith("/"))
      throw new GitHubError("Invalid GitHub API destination.");
    const mutation = method !== "GET";
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(30000);
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new GitHubError(
        mutation
          ? "GitHub did not confirm this request. Check its outcome before retrying."
          : "Unable to reach GitHub. Check your connection and try again.",
        0,
        mutation,
      );
    }
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const limited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get("x-ratelimit-remaining") === "0" ||
            retryAfter !== null));
      const reset = response.headers.get("x-ratelimit-reset");
      const retryAt = retryAfter
        ? Date.now() + Number(retryAfter) * 1000
        : reset
          ? Number(reset) * 1000
          : undefined;
      const message = limited
        ? "GitHub rate limit reached. Try again after the limit resets."
        : response.status === 401
          ? "The token is invalid or expired. Reconnect with a valid token."
          : response.status === 403
            ? "GitHub denied access. Check token permissions and organization policies."
            : response.status === 404
              ? "Repository, branch, or file is missing or not accessible with this token."
              : response.status === 409
                ? "GitHub reported a conflict. Refresh and review again."
                : response.status === 422
                  ? "GitHub rejected the change. Check branch rules, permissions, and the destination."
                  : "GitHub could not complete the request. Try again after checking its outcome.";
      throw new GitHubError(
        message,
        response.status,
        mutation && response.status >= 500,
        retryAt,
      );
    }
    try {
      return (await response.json()) as ResponseType;
    } catch {
      throw new GitHubError(
        "GitHub returned an unreadable response.",
        response.status,
        mutation,
      );
    }
  }

  private root(target: { owner: string; repo: string }): string {
    const parsed = parseRepository(`${target.owner}/${target.repo}`);
    return `/repos/${segment(parsed.owner)}/${segment(parsed.repo)}`;
  }

  identity() {
    return this.request<{ login: string }>("/user");
  }
  repositories(page = 1) {
    return this.request<GitHubRepository[]>(
      `/user/repos?per_page=100&page=${page}&sort=full_name`,
    );
  }
  repository(target: { owner: string; repo: string }) {
    return this.request<GitHubRepository>(this.root(target));
  }
  branches(target: { owner: string; repo: string }, page = 1) {
    return this.request<{ name: string }[]>(
      `${this.root(target)}/branches?per_page=100&page=${page}`,
    );
  }
  async head(target: GitHubTarget): Promise<GitHubCommit> {
    const ref = await this.request<{ ref: string; object: { sha: string } }>(
      `${this.root(target)}/git/ref/heads/${segment(target.branch)}`,
    );
    if (ref.ref !== `refs/heads/${target.branch}`)
      throw new GitHubError("The selected branch no longer exists.");
    return this.request<GitHubCommit>(
      `${this.root(target)}/git/commits/${segment(ref.object.sha)}`,
    );
  }
  async tree(target: GitHubTarget, sha: string): Promise<GitHubTreeEntry[]> {
    const tree = await this.request<{
      tree: GitHubTreeEntry[];
      truncated: boolean;
    }>(`${this.root(target)}/git/trees/${segment(sha)}`);
    if (tree.truncated)
      throw new GitHubError(
        "GitHub returned an incomplete folder listing. This folder cannot be safely edited.",
      );
    return tree.tree;
  }
  async markdownFiles(
    target: GitHubTarget,
    treeSha: string,
    includeDirectories = false,
  ): Promise<GitHubTreeEntry[]> {
    const recursive = await this.request<{
      tree: GitHubTreeEntry[];
      truncated: boolean;
    }>(`${this.root(target)}/git/trees/${segment(treeSha)}?recursive=1`);
    let entries = recursive.tree;
    if (recursive.truncated) {
      entries = [];
      const remaining = [{ sha: treeSha, path: "" }];
      while (remaining.length) {
        const directory = remaining.pop()!;
        for (const entry of await this.tree(target, directory.sha)) {
          const path = [directory.path, entry.path].filter(Boolean).join("/");
          if (path.toLowerCase() === ".github/workflows") continue;
          entries.push({ ...entry, path });
          if (entry.type === "tree") remaining.push({ sha: entry.sha, path });
        }
      }
    }
    return entries
      .filter(
        (entry) =>
          ((includeDirectories && entry.type === "tree") ||
            (entry.type === "blob" &&
              (entry.mode === "100644" || entry.mode === "100755") &&
              isMarkdownPath(entry.path))) &&
          entry.path.toLowerCase() !== ".github/workflows" &&
          !entry.path.toLowerCase().startsWith(".github/workflows/"),
      )
      .sort((first, second) => first.path.localeCompare(second.path));
  }
  async folder(
    target: GitHubTarget,
    treeSha: string,
    path: string,
  ): Promise<GitHubTreeEntry[]> {
    let entries = await this.tree(target, treeSha);
    if (!path) return entries;
    for (const part of path.split("/")) {
      const directory = entries.find((entry) => entry.path === part);
      if (!directory || directory.type !== "tree")
        throw new GitHubError("The folder is missing or is not a directory.");
      entries = await this.tree(target, directory.sha);
    }
    return entries;
  }
  async entry(
    target: GitHubTarget,
    treeSha: string,
    path: string,
  ): Promise<GitHubTreeEntry | undefined> {
    validateMarkdownPath(path);
    const parts = path.split("/");
    const filename = parts.pop();
    let entries = await this.tree(target, treeSha);
    for (const part of parts) {
      const directory = entries.find((entry) => entry.path === part);
      if (!directory) return undefined;
      if (directory.type !== "tree")
        throw new GitHubError("A destination parent is not a directory.");
      entries = await this.tree(target, directory.sha);
    }
    return entries.find((entry) => entry.path === filename);
  }
  async open(
    target: GitHubTarget,
    path: string,
    commit?: GitHubCommit,
  ): Promise<GitHubOrigin> {
    validateMarkdownPath(path);
    const snapshot = commit ?? (await this.head(target));
    const entry = await this.entry(target, snapshot.tree.sha, path);
    if (!entry) throw new GitHubError("The remote file no longer exists.", 404);
    if (
      entry.type !== "blob" ||
      (entry.mode !== "100644" && entry.mode !== "100755")
    )
      throw new GitHubError(
        "Only regular Markdown files can be opened; symlinks and submodules are excluded.",
      );
    if ((entry.size ?? 0) > MAX_MARKDOWN_BYTES)
      throw new GitHubError("Markdown files must be 1 MiB or smaller.");
    const blob = await this.request<{ content: string; encoding: string }>(
      `${this.root(target)}/git/blobs/${segment(entry.sha)}`,
    );
    if (blob.encoding !== "base64")
      throw new GitHubError("GitHub returned an unsupported file encoding.");
    return {
      ...target,
      path,
      blobSha: entry.sha,
      commitSha: snapshot.sha,
      baseContent: decodeMarkdown(blob.content),
      mode: entry.mode,
    };
  }
  createBlob(target: GitHubTarget, content: string) {
    return this.request<{ sha: string }>(
      `${this.root(target)}/git/blobs`,
      "POST",
      { content: encodeMarkdown(content), encoding: "base64" },
    );
  }
  createTree(
    target: GitHubTarget,
    baseTree: string,
    changes: GitHubTreeChange[],
  ) {
    return this.request<{ sha: string }>(
      `${this.root(target)}/git/trees`,
      "POST",
      { base_tree: baseTree, tree: changes },
    );
  }
  createCommit(
    target: GitHubTarget,
    head: string,
    tree: string,
    message: string,
  ) {
    return this.request<{ sha: string }>(
      `${this.root(target)}/git/commits`,
      "POST",
      { parents: [head], tree, message },
    );
  }
  publish(target: GitHubTarget, sha: string) {
    return this.request<{ object: { sha: string } }>(
      `${this.root(target)}/git/refs/heads/${segment(target.branch)}`,
      "PATCH",
      { sha, force: false },
    );
  }
  compare(target: GitHubTarget, base: string, head: string) {
    return this.request<{
      status: "identical" | "ahead" | "behind" | "diverged";
    }>(`${this.root(target)}/compare/${segment(base)}...${segment(head)}`);
  }
}
