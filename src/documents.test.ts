import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDocument,
  deleteDocument,
  listDocuments,
  saveDocument,
  type WorkspaceDocument,
} from "./documents";

const documentIds: string[] = [];

afterEach(async () => {
  await Promise.all(documentIds.splice(0).map(deleteDocument));
});

describe("browser document storage", () => {
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
