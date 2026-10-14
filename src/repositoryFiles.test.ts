// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { inWorkspace, type WorkspaceDocument } from "./documents";
import type { GitHubTreeEntry } from "./githubClient";
import { repositoryFiles } from "./repositoryFiles";

const target = {
  repositoryId: 1,
  owner: "writer",
  repo: "notes",
  branch: "main",
};
const local: WorkspaceDocument = {
  id: "local",
  name: "Notes",
  content: "Uncommitted edits",
  updatedAt: 1,
};
const draft: WorkspaceDocument = {
  ...local,
  id: "draft",
  repository: target,
  repositoryPath: "drafts/new.md",
};
const published: WorkspaceDocument = {
  ...local,
  id: "published",
  github: {
    ...target,
    path: "docs/published.md",
    blobSha: "old-blob",
    commitSha: "head",
    baseContent: "Checked remote content",
    mode: "100644",
  },
};
const entries: GitHubTreeEntry[] = [
  { path: "docs/published.md", type: "blob", mode: "100644", sha: "new-blob" },
  { path: "assets/empty", type: "tree", mode: "040000", sha: "tree" },
];

describe("repository file selection", () => {
  it("lists remote files and unpublished drafts without mixing workspaces", () => {
    const otherBranch = {
      ...draft,
      id: "other-branch",
      repository: { ...target, branch: "feature" },
    };
    const otherRepository = {
      ...draft,
      id: "other-repo",
      repository: { ...target, repositoryId: 2 },
    };
    const result = repositoryFiles(
      entries,
      [local, draft, published, otherBranch, otherRepository],
      target,
    );
    expect(result.files.map((file) => file.path)).toEqual([
      "docs/published.md",
      "drafts/new.md",
    ]);
    expect(result.cachedByPath.get("docs/published.md")).toBe(published);
    expect(result.cachedByPath.get("drafts/new.md")).toBe(draft);
    expect(result.otherCachedFiles).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(inWorkspace(local, "local", target)).toBe(true);
    expect(inWorkspace(draft, "local", target)).toBe(false);
    expect(inWorkspace(otherBranch, "repository", target)).toBe(false);
  });

  it("retains missing published files separately and keeps them available offline", () => {
    const result = repositoryFiles([], [published, draft], target);
    expect(result.files.map((file) => file.path)).toEqual(["drafts/new.md"]);
    expect(result.otherCachedFiles).toEqual([published]);
    expect(result.cachedByPath.get("docs/published.md")).toBe(published);
  });

  it("does not use an unpublished draft to shadow a remote entry", () => {
    const collision = { ...draft, repositoryPath: "docs/published.md" };
    const result = repositoryFiles(entries, [collision], target);
    expect(result.files).toEqual([entries[0]]);
    expect(result.cachedByPath.has("docs/published.md")).toBe(false);
    expect(result.otherCachedFiles).toEqual([collision]);
    expect(result.remotePaths.has("assets/empty")).toBe(true);
  });

  it("preserves first eligible cached-copy selection and case-sensitive paths", () => {
    const duplicate = { ...published, id: "second-copy" };
    const caseVariant = { ...draft, repositoryPath: "docs/Published.md" };
    const result = repositoryFiles(
      entries,
      [published, duplicate, caseVariant],
      target,
    );
    expect(result.cachedByPath.get("docs/published.md")).toBe(published);
    expect(result.cachedByPath.get("docs/Published.md")).toBe(caseVariant);
    expect(result.otherCachedFiles).toEqual([]);
  });

  it("includes root, remote directories and nested draft directories", () => {
    const result = repositoryFiles(
      entries,
      [{ ...draft, repositoryPath: "drafts/deep/new.md" }],
      target,
    );
    expect([...result.directories].sort()).toEqual([
      "",
      "assets",
      "assets/empty",
      "docs",
      "drafts",
      "drafts/deep",
    ]);
  });

  it("does not match repository documents without a selected repository", () => {
    const result = repositoryFiles([], [local, draft, published], null);
    expect(result.files).toEqual([]);
    expect(result.otherCachedFiles).toEqual([]);
    expect(result.cachedByPath.size).toBe(0);
  });
});
