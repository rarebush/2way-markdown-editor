import { openDB } from "idb";

export type GitHubOrigin = {
  repositoryId: number;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  blobSha: string;
  commitSha: string;
  baseContent: string;
  mode: "100644" | "100755";
};

export type GitHubPending = {
  candidateSha: string;
  previousHead: string;
  origin: GitHubOrigin;
  operation: "create" | "update" | "move" | "delete";
};

export type RepositoryWorkspace = Pick<
  GitHubOrigin,
  "repositoryId" | "owner" | "repo" | "branch"
>;

export type WorkspaceDocument = {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  github?: GitHubOrigin;
  githubPending?: GitHubPending;
  repository?: RepositoryWorkspace;
  repositoryPath?: string;
};

export function documentRepository(
  document: WorkspaceDocument,
): RepositoryWorkspace | undefined {
  return document.github ?? document.repository;
}

export function inWorkspace(
  document: WorkspaceDocument,
  space: "local" | "repository",
  repository: RepositoryWorkspace | null,
) {
  const owner = documentRepository(document);
  return space === "local"
    ? !owner
    : !!owner &&
        !!repository &&
        owner.repositoryId === repository.repositoryId &&
        owner.branch === repository.branch;
}

function isRepositoryWorkspace(value: unknown): value is RepositoryWorkspace {
  if (!value || typeof value !== "object") return false;
  const repository = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(repository.repositoryId) &&
    Number(repository.repositoryId) > 0 &&
    ["owner", "repo", "branch"].every(
      (key) => typeof repository[key] === "string" && repository[key] !== "",
    )
  );
}

export function isGitHubOrigin(value: unknown): value is GitHubOrigin {
  if (!value || typeof value !== "object") return false;
  const origin = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(origin.repositoryId) &&
    Number(origin.repositoryId) > 0 &&
    ["owner", "repo", "branch", "path", "blobSha", "commitSha"].every(
      (key) => typeof origin[key] === "string" && origin[key] !== "",
    ) &&
    typeof origin.baseContent === "string" &&
    (origin.mode === "100644" || origin.mode === "100755")
  );
}

function isGitHubPending(value: unknown): value is GitHubPending {
  if (!value || typeof value !== "object") return false;
  const pending = value as Record<string, unknown>;
  return (
    typeof pending.candidateSha === "string" &&
    pending.candidateSha !== "" &&
    typeof pending.previousHead === "string" &&
    pending.previousHead !== "" &&
    ["create", "update", "move", "delete"].includes(
      String(pending.operation),
    ) &&
    isGitHubOrigin(pending.origin)
  );
}

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
    .map((document) => ({
      id: document.id,
      name: document.name,
      content: document.content,
      updatedAt: document.updatedAt,
      ...(isRepositoryWorkspace(document.repository)
        ? { repository: document.repository }
        : {}),
      ...(typeof document.repositoryPath === "string" &&
      document.repositoryPath !== ""
        ? { repositoryPath: document.repositoryPath }
        : {}),
      ...(isGitHubOrigin(document.github) ? { github: document.github } : {}),
      ...(isGitHubPending(document.githubPending)
        ? { githubPending: document.githubPending }
        : {}),
    }))
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
