import { openDB } from "idb";

export type WorkspaceDocument = {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
};

const databasePromise = openDB("draft-markdown-workspace", 1, {
  upgrade(database) {
    database.createObjectStore("documents", { keyPath: "id" });
  },
});

export function createDocument(
  name: string,
  content: string,
): WorkspaceDocument {
  return {
    id: crypto.randomUUID(),
    name,
    content,
    updatedAt: Date.now(),
  };
}

export async function listDocuments(): Promise<WorkspaceDocument[]> {
  const database = await databasePromise;
  const documents = await database.getAll("documents");
  return documents
    .filter(
      (document): document is WorkspaceDocument =>
        typeof document?.id === "string" &&
        typeof document?.name === "string" &&
        typeof document?.content === "string" &&
        typeof document?.updatedAt === "number",
    )
    .sort((first, second) => second.updatedAt - first.updatedAt);
}

export async function saveDocument(document: WorkspaceDocument): Promise<void> {
  const database = await databasePromise;
  await database.put("documents", document);
}

export async function deleteDocument(id: string): Promise<void> {
  const database = await databasePromise;
  await database.delete("documents", id);
}
