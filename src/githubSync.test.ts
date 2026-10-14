import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { GitHubOrigin, WorkspaceDocument } from "./documents";
import { documentRepository } from "./documents";
import { GitHubClient } from "./githubClient";
import {
  buildGitHubCommit,
  checkGitHubCommit,
  finishGitHubCommit,
  prepareGitHubChange,
  repositoryFilename,
} from "./githubSync";

const origin: GitHubOrigin = {
  repositoryId: 1,
  owner: "writer",
  repo: "notes",
  branch: "main",
  path: "old.md",
  blobSha: "old-blob",
  commitSha: "old-head",
  baseContent: "Original\n",
  mode: "100755",
};
const document: WorkspaceDocument = {
  id: "draft",
  name: "Local name",
  content: "Edited\n",
  updatedAt: 1,
  github: origin,
};

function mockClient() {
  const client = new GitHubClient("test-token");
  vi.spyOn(client, "repository").mockResolvedValue({
    id: 1,
    name: "notes",
    owner: { login: "writer" },
    full_name: "writer/notes",
    default_branch: "main",
    archived: false,
  });
  vi.spyOn(client, "head").mockResolvedValue({
    sha: "current-head",
    tree: { sha: "current-tree" },
  });
  vi.spyOn(client, "open").mockResolvedValue(origin);
  vi.spyOn(client, "entry").mockResolvedValue(undefined);
  vi.spyOn(client, "createBlob").mockResolvedValue({ sha: "new-blob" });
  vi.spyOn(client, "createTree").mockResolvedValue({ sha: "new-tree" });
  vi.spyOn(client, "createCommit").mockResolvedValue({ sha: "candidate" });
  vi.spyOn(client, "compare").mockResolvedValue({ status: "ahead" });
  return client;
}

describe("reviewed GitHub commits", () => {
  it("translates local titles into safe Markdown filenames without name matching", () => {
    expect(repositoryFilename("Quarter / Q4: plans? ")).toBe(
      "Quarter-Q4-plans.md",
    );
    expect(repositoryFilename("Notes.MD")).toBe("Notes.md");
    expect(repositoryFilename("../ ")).toBe("document.md");
    expect(repositoryFilename("日本語 notes")).toBe("日本語-notes.md");
  });

  it("transfers the same local document into the repository after publication", () => {
    const local = { ...document, github: undefined };
    expect(documentRepository(local)).toBeUndefined();
    const transferred = finishGitHubCommit(local, {
      operation: "create",
      candidateSha: "new",
      previousHead: "old",
      origin: { ...origin, path: "docs/Local-name.md" },
    });
    expect(transferred.id).toBe(local.id);
    expect(transferred.content).toBe(local.content);
    expect(documentRepository(transferred)?.repositoryId).toBe(
      origin.repositoryId,
    );
    expect(transferred.github?.path).toBe("docs/Local-name.md");
  });
  it("bases an update on the latest tree/head while preserving file mode", async () => {
    const client = mockClient();
    const review = await prepareGitHubChange(
      client,
      document,
      "update",
      origin,
    );
    const pending = await buildGitHubCommit(client, review, "Update notes");
    expect(client.createTree).toHaveBeenCalledWith(
      expect.anything(),
      "current-tree",
      [{ path: "old.md", mode: "100755", type: "blob", sha: "new-blob" }],
    );
    expect(client.createCommit).toHaveBeenCalledWith(
      expect.anything(),
      "current-head",
      "new-tree",
      "Update notes",
    );
    expect(pending.origin.baseContent).toBe("Edited\n");
  });

  it("moves the remote blob atomically and leaves draft edits uncommitted", async () => {
    const client = mockClient();
    const review = await prepareGitHubChange(
      client,
      document,
      "move",
      origin,
      "folder/new.md",
    );
    const pending = await buildGitHubCommit(client, review, "Move notes");
    expect(client.createBlob).not.toHaveBeenCalled();
    expect(client.createTree).toHaveBeenCalledWith(
      expect.anything(),
      "current-tree",
      [
        {
          path: "folder/new.md",
          mode: "100755",
          type: "blob",
          sha: "old-blob",
        },
        { path: "old.md", mode: "100755", type: "blob", sha: null },
      ],
    );
    expect(finishGitHubCommit(document, pending)).toMatchObject({
      content: "Edited\n",
      github: { path: "folder/new.md", baseContent: "Original\n" },
    });
  });

  it("deletes remotely without deleting local content", async () => {
    const client = mockClient();
    const pending = await buildGitHubCommit(
      client,
      await prepareGitHubChange(client, document, "delete", origin),
      "Delete notes",
    );
    expect(client.createTree).toHaveBeenCalledWith(
      expect.anything(),
      "current-tree",
      [{ path: "old.md", mode: "100755", type: "blob", sha: null }],
    );
    expect(finishGitHubCommit(document, pending)).toMatchObject({
      id: document.id,
      content: document.content,
    });
    expect(finishGitHubCommit(document, pending).github).toBeUndefined();
    expect(
      documentRepository(finishGitHubCommit(document, pending))?.repositoryId,
    ).toBe(origin.repositoryId);
  });

  it("blocks changed source blobs and destination collisions", async () => {
    const client = mockClient();
    vi.mocked(client.open).mockResolvedValueOnce({
      ...origin,
      blobSha: "different",
    });
    await expect(
      prepareGitHubChange(client, document, "update", origin),
    ).rejects.toMatchObject({ status: 409 });
    vi.mocked(client.entry).mockResolvedValueOnce({
      path: "new.md",
      mode: "100644",
      type: "blob",
      sha: "existing",
    });
    await expect(
      prepareGitHubChange(client, document, "move", origin, "new.md"),
    ).rejects.toThrow("already exists");
    expect(client.createCommit).not.toHaveBeenCalled();
  });

  it("creates a new linked file without an existing base and blocks no-op updates", async () => {
    const client = mockClient();
    const review = await prepareGitHubChange(
      client,
      { ...document, github: undefined },
      "create",
      origin,
      "new.md",
    );
    expect(review.before).toBe("");
    expect(review.origin.mode).toBe("100644");
    await expect(
      prepareGitHubChange(
        client,
        { ...document, content: origin.baseContent },
        "update",
        origin,
      ),
    ).rejects.toThrow("no Markdown changes");
  });

  it("reconciles candidates on the branch and retains later local edits", async () => {
    const client = mockClient();
    const pending = await buildGitHubCommit(
      client,
      await prepareGitHubChange(client, document, "update", origin),
      "Update",
    );
    vi.mocked(client.head).mockResolvedValueOnce({
      sha: "later-head",
      tree: { sha: "tree" },
    });
    await expect(checkGitHubCommit(client, pending)).resolves.toBe("published");
    vi.mocked(client.head).mockResolvedValueOnce({
      sha: pending.previousHead,
      tree: { sha: "tree" },
    });
    await expect(checkGitHubCommit(client, pending)).resolves.toBe(
      "not-published",
    );
    vi.mocked(client.compare).mockResolvedValueOnce({ status: "diverged" });
    vi.mocked(client.head).mockResolvedValueOnce({
      sha: "diverged-head",
      tree: { sha: "tree" },
    });
    await expect(checkGitHubCommit(client, pending)).resolves.toBe("unknown");
    expect(
      finishGitHubCommit({ ...document, content: "Later local edits" }, pending)
        .content,
    ).toBe("Later local edits");
  });
});
