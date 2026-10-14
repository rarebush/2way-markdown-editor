import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDocument,
  deleteDocument,
  listDocuments,
  saveDocument,
  documentRepository,
  type GitHubOrigin,
  type WorkspaceDocument,
} from "./documents";

const documentIds: string[] = [];

afterEach(async () => {
  await Promise.all(documentIds.splice(0).map(deleteDocument));
});

describe("browser document storage", () => {
  const origin: GitHubOrigin = {
    repositoryId: 1,
    owner: "writer",
    repo: "notes",
    branch: "main",
    path: "notes.md",
    blobSha: "blob",
    commitSha: "commit",
    baseContent: "Original\r\n",
    mode: "100644",
  };

  it("persists repository membership independently of a remote file link", async () => {
    const repository = {
      repositoryId: origin.repositoryId,
      owner: origin.owner,
      repo: origin.repo,
      branch: origin.branch,
    };
    const document = {
      ...createDocument("Retained repo copy", "Local working content"),
      repository,
      repositoryPath: "drafts/retained.md",
    };
    documentIds.push(document.id);
    await saveDocument(document);
    const stored = (await listDocuments()).find(
      (item) => item.id === document.id,
    )!;
    expect(documentRepository(stored)).toEqual(repository);
    expect(stored.repositoryPath).toBe("drafts/retained.md");
    expect(stored.github).toBeUndefined();
    expect(documentRepository(createDocument("Local", ""))).toBeUndefined();
    expect(
      documentRepository({
        ...createDocument("Legacy repo", ""),
        github: origin,
      }),
    ).toBe(origin);
  });

  it("persists GitHub origins and pending commit recovery with local edits", async () => {
    const document = {
      ...createDocument("Notes", "New local edits"),
      github: origin,
      githubPending: {
        candidateSha: "candidate",
        previousHead: "commit",
        origin,
        operation: "update" as const,
      },
    };
    documentIds.push(document.id);
    await saveDocument(document);
    await expect(listDocuments()).resolves.toContainEqual(document);
  });

  it("keeps valid drafts when optional GitHub metadata is malformed", async () => {
    const document = createDocument("Local", "Keep this");
    documentIds.push(document.id);
    await saveDocument({
      ...document,
      github: { token: "do-not-load" },
    } as unknown as WorkspaceDocument);
    await expect(listDocuments()).resolves.toContainEqual(document);
  });

  it("creates and persists a named Markdown document", async () => {
    const document = createDocument("Meeting notes", "# Decisions\n");
    documentIds.push(document.id);

    await saveDocument(document);

    await expect(listDocuments()).resolves.toContainEqual(document);
  });

  it("lists recently edited documents first", async () => {
    const older = { ...createDocument("Older", ""), updatedAt: 100 };
    const newer = { ...createDocument("Newer", ""), updatedAt: 200 };
    documentIds.push(older.id, newer.id);

    await saveDocument(older);
    await saveDocument(newer);

    const listed = (await listDocuments()).filter((document) =>
      documentIds.includes(document.id),
    );
    expect(listed.map((document) => document.id)).toEqual([newer.id, older.id]);
  });

  it("deletes documents and ignores malformed stored records", async () => {
    const valid = createDocument("Temporary", "Draft");
    const invalid = {
      id: "invalid-record-test",
      name: "Broken record",
      content: 42,
      updatedAt: Date.now(),
    } as unknown as WorkspaceDocument;
    documentIds.push(valid.id, invalid.id);

    await saveDocument(valid);
    await saveDocument(invalid);
    expect((await listDocuments()).map((document) => document.id)).toContain(
      valid.id,
    );
    expect(
      (await listDocuments()).map((document) => document.id),
    ).not.toContain(invalid.id);

    await deleteDocument(valid.id);
    expect(
      (await listDocuments()).map((document) => document.id),
    ).not.toContain(valid.id);
  });
});
