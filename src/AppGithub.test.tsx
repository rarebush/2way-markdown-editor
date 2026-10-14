// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { useState } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "./documents";
import type {
  GitHubOrigin,
  GitHubPending,
  WorkspaceDocument,
} from "./documents";
import { finishGitHubCommit } from "./githubSync";

const origin: GitHubOrigin = {
  repositoryId: 1,
  owner: "writer",
  repo: "notes",
  branch: "main",
  path: "notes.md",
  blobSha: "blob",
  commitSha: "head",
  baseContent: "Remote\n",
  mode: "100644",
};
const pending: GitHubPending = {
  candidateSha: "candidate",
  previousHead: "head",
  operation: "update",
  origin: {
    ...origin,
    blobSha: "new-blob",
    commitSha: "candidate",
    baseContent: "Committed\n",
  },
};

vi.mock("./MarkdownSurface", () => ({
  MarkdownSurface: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (content: string, origin: "source") => void;
  }) => (
    <textarea
      aria-label="Local text"
      value={value}
      onChange={(event) => onChange(event.target.value, "source")}
    />
  ),
}));
vi.mock("./GitHubWorkspace", () => ({
  GitHubWorkspace: function MockWorkspace({
    document,
    onOpen,
    onUpdate,
    onWorkspaceChange,
    onNew,
    onImport,
    onRemoveWorkingCopy,
    onSaveLocalCopy,
    onDeleteWorkingCopy,
  }: {
    document: WorkspaceDocument;
    onWorkspaceChange: (space: "local" | "repository") => void;
    onNew: (repository?: storage.RepositoryWorkspace, paths?: string[]) => void;
    onImport: (
      repository?: storage.RepositoryWorkspace,
      paths?: string[],
    ) => void;
    onRemoveWorkingCopy: () => void;
    onSaveLocalCopy: (document: WorkspaceDocument) => Promise<void>;
    onDeleteWorkingCopy: (id: string) => Promise<void>;
    onOpen: (origin: GitHubOrigin, separate?: boolean) => Promise<void>;
    onUpdate: (
      id: string,
      update: (current: WorkspaceDocument) => WorkspaceDocument,
    ) => Promise<void>;
  }) {
    const [error, setError] = useState("");
    return (
      <aside aria-label="Test file navigation">
        <output data-testid="draft">{JSON.stringify(document)}</output>
        <button onClick={onRemoveWorkingCopy}>Remove cached copy</button>
        <button onClick={() => void onSaveLocalCopy(document)}>
          Save Local copy
        </button>
        <button
          onClick={() =>
            void (async () => {
              await onUpdate(document.id, (current) =>
                finishGitHubCommit(current, {
                  ...pending,
                  operation: "delete",
                }),
              );
              await onDeleteWorkingCopy(document.id);
            })()
          }
        >
          Finish remote deletion
        </button>
        <button onClick={() => onNew()}>Add local file</button>
        <button
          onClick={() =>
            onNew(
              {
                repositoryId: 1,
                owner: "writer",
                repo: "notes",
                branch: "main",
              },
              ["docs/existing.md"],
            )
          }
        >
          Add repository file
        </button>
        <button onClick={() => onImport()}>Import local file</button>
        <button
          onClick={() =>
            onImport(
              {
                repositoryId: 1,
                owner: "writer",
                repo: "notes",
                branch: "main",
              },
              ["docs/existing.md"],
            )
          }
        >
          Import repository file
        </button>
        <button onClick={() => onWorkspaceChange("local")}>Local space</button>
        <button onClick={() => onWorkspaceChange("repository")}>
          Repository space
        </button>
        <button
          onClick={() =>
            void onUpdate(document.id, (current) =>
              finishGitHubCommit(current, {
                ...pending,
                operation: "create",
                origin: {
                  ...pending.origin,
                  path: "docs/Notes.md",
                  baseContent: current.content,
                },
              }),
            ).catch(() => setError("Transfer failed"))
          }
        >
          Move current file
        </button>
        <button onClick={() => void onOpen(origin)}>Open remote</button>
        <button onClick={() => void onOpen(origin, true)}>Remote copy</button>
        <button
          onClick={() =>
            void onUpdate(document.id, (current) => ({
              ...current,
              githubPending: pending,
            })).catch(() => setError("Pending save failed"))
          }
        >
          Record pending
        </button>
        <button
          onClick={() =>
            void onUpdate(document.id, (current) =>
              finishGitHubCommit(current, pending),
            ).catch(() => setError("Final save failed"))
          }
        >
          Finish commit
        </button>
        {error && <p role="alert">{error}</p>}
      </aside>
    );
  },
}));

import App from "./App";

beforeEach(async () => {
  for (const document of await storage.listDocuments())
    await storage.deleteDocument(document.id);
  await storage.saveDocument(storage.createDocument("Notes", "Local draft"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App GitHub document ownership", () => {
  it("persists a new independent Local copy of the current uncommitted draft", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Local text");
    await user.click(screen.getByRole("button", { name: "Open remote" }));
    await user.clear(screen.getByLabelText("Local text"));
    await user.type(screen.getByLabelText("Local text"), "Uncommitted draft");
    const original = JSON.parse(
      screen.getByTestId("draft").textContent!,
    ) as WorkspaceDocument;
    await user.click(screen.getByRole("button", { name: "Save Local copy" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "notes copy" })).toBeDefined(),
    );
    const copy = JSON.parse(
      screen.getByTestId("draft").textContent!,
    ) as WorkspaceDocument;
    expect(copy.id).not.toBe(original.id);
    expect(copy.content).toBe("Uncommitted draft");
    expect(storage.documentRepository(copy)).toBeUndefined();
    expect(copy.github).toBeUndefined();
    expect(copy.githubPending).toBeUndefined();
    const stored = await storage.listDocuments();
    expect(stored.find((item) => item.id === copy.id)).toEqual(copy);
    expect(stored.find((item) => item.id === original.id)?.github).toEqual(
      origin,
    );
  });

  it("removes a published file from IndexedDB after confirmed remote deletion", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Local text");
    await user.click(screen.getByRole("button", { name: "Open remote" }));
    const original = JSON.parse(
      screen.getByTestId("draft").textContent!,
    ) as WorkspaceDocument;
    await user.click(
      screen.getByRole("button", { name: "Finish remote deletion" }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Local text")).toBeNull(),
    );
    expect(
      (await storage.listDocuments()).find((item) => item.id === original.id),
    ).toBeUndefined();
  });

  it("renames unpublished repo paths locally and removes cached copies without GitHub actions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Local text");
    await user.click(
      screen.getByRole("button", { name: "Add repository file" }),
    );
    await user.clear(screen.getByLabelText("Document name"));
    await user.type(screen.getByLabelText("Document name"), "Draft");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("draft").textContent!).repositoryPath,
      ).toBe("Draft.md"),
    );
    await user.click(screen.getByRole("button", { name: "Rename draft" }));
    await user.clear(screen.getByLabelText("Repository path"));
    await user.type(
      screen.getByLabelText("Repository path"),
      "drafts/Renamed.md",
    );
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("draft").textContent!).repositoryPath,
      ).toBe("drafts/Renamed.md"),
    );
    expect(
      JSON.parse(screen.getByTestId("draft").textContent!).github,
    ).toBeUndefined();
    await user.click(
      screen.getByRole("button", { name: "Remove cached copy" }),
    );
    expect(
      screen.getByRole("heading", { name: "Remove working copy?" }),
    ).toBeDefined();
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove working copy",
      }),
    );
    await waitFor(async () =>
      expect(await storage.listDocuments()).toHaveLength(1),
    );
    expect((await storage.listDocuments())[0].content).toBe("Local draft");
    expect(screen.queryByLabelText("Local text")).toBeNull();
  });

  it("removes the global selector and keeps file actions in the rail and document heading", async () => {
    render(<App />);
    await screen.findByLabelText("Local text");
    expect(screen.queryByLabelText("Choose a document")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add local file" }).closest("aside"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Import local file" })
        .closest("aside"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Export Markdown" })
        .closest(".title-actions"),
    ).not.toBeNull();
    expect(document.querySelector(".app-header select")).toBeNull();
  });

  it("creates repository-owned drafts at an explicit path without matching local names", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Local text");
    await user.click(
      screen.getByRole("button", { name: "Add repository file" }),
    );
    await user.clear(screen.getByLabelText("Document name"));
    await user.type(screen.getByLabelText("Document name"), "Notes");
    await user.clear(screen.getByLabelText("Repository path"));
    await user.type(
      screen.getByLabelText("Repository path"),
      "docs/existing.md",
    );
    expect(screen.getByRole("alert").textContent).toContain("already exists");
    expect(
      screen.getByRole("button", { name: "Create" }).hasAttribute("disabled"),
    ).toBe(true);
    await user.clear(screen.getByLabelText("Repository path"));
    await user.type(screen.getByLabelText("Repository path"), "drafts/new.md");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("draft").textContent!).repositoryPath,
      ).toBe("drafts/new.md"),
    );
    const created = JSON.parse(
      screen.getByTestId("draft").textContent!,
    ) as WorkspaceDocument;
    expect(created.repository?.repositoryId).toBe(1);
    expect(created.github).toBeUndefined();
    expect(
      (await storage.listDocuments()).find(
        (item) => !storage.documentRepository(item),
      )?.content,
    ).toBe("Local draft");
    await user.click(screen.getByRole("button", { name: "Local space" }));
    expect(
      (screen.getByLabelText("Local text") as HTMLTextAreaElement).value,
    ).toBe("Local draft");
  });

  it("imports new files into the chosen workspace without overwriting drafts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Local text");
    const repoFile = new File(["Repository import"], "Notes.md", {
      type: "text/markdown",
    });
    Object.defineProperty(repoFile, "text", {
      value: async () => "Repository import",
    });
    await user.click(
      screen.getByRole("button", { name: "Import repository file" }),
    );
    await user.upload(screen.getByLabelText("Import Markdown file"), repoFile);
    await screen.findByRole("heading", { name: "Import file" });
    await user.clear(screen.getByLabelText("Repository path"));
    await user.type(
      screen.getByLabelText("Repository path"),
      "imports/Notes.md",
    );
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("draft").textContent!).repositoryPath,
      ).toBe("imports/Notes.md"),
    );
    expect(
      (screen.getByLabelText("Local text") as HTMLTextAreaElement).value,
    ).toBe("Repository import");
    const localFile = new File(["Local import"], "Notes.md", {
      type: "text/markdown",
    });
    Object.defineProperty(localFile, "text", {
      value: async () => "Local import",
    });
    await user.click(screen.getByRole("button", { name: "Import local file" }));
    await user.upload(screen.getByLabelText("Import Markdown file"), localFile);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Local text") as HTMLTextAreaElement).value,
      ).toBe("Local import"),
    );
    expect(
      storage.documentRepository(
        JSON.parse(screen.getByTestId("draft").textContent!),
      ),
    ).toBeUndefined();
    expect(await storage.listDocuments()).toHaveLength(3);
  });

  it("places the document heading and editor together beside the rail without a page footer", async () => {
    render(<App />);
    const editor = await screen.findByLabelText("Local text");
    const heading = screen.getByRole("heading", { name: "Notes" });
    expect(heading.closest(".document-workspace")).toBe(
      editor.closest(".document-workspace"),
    );
    expect(heading.closest(".workspace-body")).not.toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("keeps workspace selection scoped and transfers rather than duplicates local files", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Local text");
    const before = JSON.parse(
      screen.getByTestId("draft").textContent!,
    ) as WorkspaceDocument;
    await user.click(screen.getByRole("button", { name: "Move current file" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("draft").textContent!).github?.path,
      ).toBe("docs/Notes.md"),
    );
    expect(JSON.parse(screen.getByTestId("draft").textContent!).id).toBe(
      before.id,
    );
    expect(
      (await storage.listDocuments()).filter((item) => item.id === before.id),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Local space" }));
    expect(screen.queryByLabelText("Local text")).toBeNull();
    expect(JSON.parse(screen.getByTestId("draft").textContent!).id).toBe("");
    expect(screen.getByText("No local files")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Repository space" }));
    await screen.findByLabelText("Local text");
    expect(
      (screen.getByLabelText("Local text") as HTMLTextAreaElement).value,
    ).toBe(before.content);
  });

  it("imports without overwriting, reopens without replacing edits, and permits separate copies", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Local text");
    await user.click(screen.getByRole("button", { name: "Open remote" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Local text") as HTMLTextAreaElement).value,
      ).toBe("Remote\n"),
    );
    await user.clear(screen.getByLabelText("Local text"));
    await user.type(
      screen.getByLabelText("Local text"),
      "Uncommitted local edits",
    );
    await user.click(screen.getByRole("button", { name: "Open remote" }));
    expect(
      (screen.getByLabelText("Local text") as HTMLTextAreaElement).value,
    ).toBe("Uncommitted local edits");
    await waitFor(async () =>
      expect(await storage.listDocuments()).toHaveLength(2),
    );
    expect(
      (await storage.listDocuments()).find((document) => !document.github)
        ?.content,
    ).toBe("Local draft");
    await user.click(screen.getByRole("button", { name: "Remote copy" }));
    await waitFor(async () =>
      expect(await storage.listDocuments()).toHaveLength(3),
    );
  });

  it("retains a durable recovery marker if final local persistence fails after publication", async () => {
    const user = userEvent.setup();
    const save = storage.saveDocument;
    let failFinalSave = false;
    vi.spyOn(storage, "saveDocument").mockImplementation(async (document) => {
      if (
        failFinalSave &&
        document.github?.commitSha === "candidate" &&
        !document.githubPending
      )
        throw new Error("Storage full");
      await save(document);
    });
    render(<App />);
    await screen.findByLabelText("Local text");
    await user.click(screen.getByRole("button", { name: "Open remote" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("draft").textContent!).github?.commitSha,
      ).toBe("head"),
    );
    await user.click(screen.getByRole("button", { name: "Record pending" }));
    await waitFor(async () =>
      expect(
        (await storage.listDocuments()).some(
          (document) => document.githubPending?.candidateSha === "candidate",
        ),
      ).toBe(true),
    );
    failFinalSave = true;
    await user.click(screen.getByRole("button", { name: "Finish commit" }));
    await screen.findByText("Final save failed");
    const draft = JSON.parse(
      screen.getByTestId("draft").textContent!,
    ) as WorkspaceDocument;
    expect(draft.github?.commitSha).toBe("head");
    expect(draft.githubPending?.candidateSha).toBe("candidate");
    expect(draft.content).toBe("Remote\n");
    await waitFor(async () =>
      expect(
        (await storage.listDocuments()).find(
          (document) => document.id === draft.id,
        )?.githubPending?.candidateSha,
      ).toBe("candidate"),
    );
  });
});
