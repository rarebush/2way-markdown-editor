// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "./documents";
import { useDocumentWorkspace } from "./useDocumentWorkspace";

const repository: storage.RepositoryWorkspace = {
  repositoryId: 1,
  owner: "writer",
  repo: "notes",
  branch: "main",
};
const origin: storage.GitHubOrigin = {
  ...repository,
  path: "docs/Notes.md",
  blobSha: "blob",
  commitSha: "head",
  baseContent: "Remote\n",
  mode: "100644",
};

beforeEach(async () => {
  for (const document of await storage.listDocuments())
    await storage.deleteDocument(document.id);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openWorkspace() {
  const hook = renderHook(() => useDocumentWorkspace("Starter Markdown"));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

describe("document workspace lifecycle", () => {
  it("creates a persisted starter when storage is empty and restores drafts on remount", async () => {
    const first = await openWorkspace();
    const starter = first.result.current.activeDocument!;
    expect(starter.content).toBe("Starter Markdown");
    expect(await storage.listDocuments()).toEqual([starter]);
    first.unmount();

    const second = await openWorkspace();
    expect(second.result.current.activeDocument?.id).toBe(starter.id);
    expect(second.result.current.documents).toHaveLength(1);
  });

  it("creates drafts in their workspace and scopes selection by repository and branch", async () => {
    const { result } = await openWorkspace();
    const local = result.current.activeDocument!;
    await act(async () => {
      await result.current.createDraft("Notes", "Repository draft", {
        repository,
        path: "drafts/Notes.md",
      });
    });
    const draft = result.current.activeDocument!;
    expect(result.current.space).toBe("repository");
    expect(draft.github).toBeUndefined();
    expect(draft.repositoryPath).toBe("drafts/Notes.md");
    expect(
      (await storage.listDocuments()).find((item) => item.id === draft.id),
    ).toEqual(draft);

    act(() => result.current.selectWorkspace("local"));
    expect(result.current.activeDocument?.id).toBe(local.id);
    act(() =>
      result.current.selectWorkspace("repository", {
        ...repository,
        branch: "another-branch",
      }),
    );
    expect(result.current.activeDocument).toBeUndefined();
    act(() => result.current.selectWorkspace("repository", repository));
    expect(result.current.activeDocument?.id).toBe(draft.id);
  });

  it("persists edits to a document after selecting another workspace", async () => {
    const { result } = await openWorkspace();
    const localId = result.current.activeDocument!.id;
    act(() => result.current.updateContent("Edited source", "source"));
    expect(result.current.editOrigin).toBe("source");
    act(() => result.current.selectWorkspace("repository", repository));
    expect(result.current.activeDocument).toBeUndefined();
    expect(result.current.editOrigin).toBeUndefined();
    await waitFor(async () => {
      expect(
        (await storage.listDocuments()).find((item) => item.id === localId)
          ?.content,
      ).toBe("Edited source");
    });
  });

  it("imports uniquely named Local files without matching repository drafts", async () => {
    const { result } = await openWorkspace();
    await act(async () => {
      await result.current.createDraft("Notes", "Original");
      await result.current.createDraft("Notes (2)", "Repo content", {
        repository,
        path: "Notes.md",
      });
      await result.current.importLocalDocument("notes", "Imported");
    });
    expect(result.current.activeDocument?.name).toBe("notes (2)");
    expect(result.current.space).toBe("local");
    const stored = await storage.listDocuments();
    expect(stored.find((item) => item.name === "Notes")?.content).toBe(
      "Original",
    );
    expect(stored).toHaveLength(4);
  });

  it("does not expose an unpersisted draft when creation fails", async () => {
    const { result } = await openWorkspace();
    const previous = result.current.activeDocument!;
    vi.spyOn(storage, "saveDocument").mockRejectedValue(
      new Error("Storage full"),
    );
    await act(async () => {
      await expect(
        result.current.createDraft("Unsaved", "Retain existing drafts"),
      ).rejects.toThrow("Storage full");
    });
    expect(result.current.activeDocument?.id).toBe(previous.id);
    expect(result.current.documents).toEqual([previous]);
    expect(result.current.saveState).toBe("error");
    expect(await storage.listDocuments()).toEqual([previous]);
  });

  it("cancels pending autosaves before deletion and creates a persisted Local replacement", async () => {
    const { result } = await openWorkspace();
    const deletedId = result.current.activeDocument!.id;
    act(() => result.current.updateContent("Never resurrect", "rich"));
    await act(async () => result.current.removeDocument(deletedId));
    const replacement = result.current.activeDocument!;
    expect(replacement.id).not.toBe(deletedId);
    expect(replacement.content).toBe("Starter Markdown");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await storage.listDocuments()).toEqual([replacement]);
  });

  it("retains the document and reports a failed deletion", async () => {
    const { result } = await openWorkspace();
    const previous = result.current.activeDocument!;
    vi.spyOn(storage, "deleteDocument").mockRejectedValue(
      new Error("Deletion failed"),
    );
    await act(async () => {
      await expect(result.current.removeDocument(previous.id)).rejects.toThrow(
        "Deletion failed",
      );
    });
    expect(result.current.activeDocument).toEqual(previous);
    expect(result.current.saveState).toBe("error");
    expect(await storage.listDocuments()).toEqual([previous]);
  });

  it("flushes pending edits on unmount", async () => {
    const { result, unmount } = await openWorkspace();
    const id = result.current.activeDocument!.id;
    act(() => result.current.updateContent("Final draft", "rich"));
    unmount();
    await waitFor(async () =>
      expect(
        (await storage.listDocuments()).find((item) => item.id === id)?.content,
      ).toBe("Final draft"),
    );
  });

  it("reopens a cached GitHub draft without overwriting edits and permits an independent copy", async () => {
    const { result } = await openWorkspace();
    await act(async () => result.current.openGitHubDocument(origin));
    const cachedId = result.current.activeDocument!.id;
    act(() => result.current.updateContent("Uncommitted", "source"));
    await act(async () =>
      result.current.openGitHubDocument({ ...origin, baseContent: "New remote" }),
    );
    expect(result.current.activeDocument?.id).toBe(cachedId);
    expect(result.current.activeDocument?.content).toBe("Uncommitted");
    await act(async () => result.current.openGitHubDocument(origin, true));
    expect(result.current.activeDocument?.id).not.toBe(cachedId);
    expect(result.current.activeDocument?.content).toBe(origin.baseContent);
    expect(result.current.documents).toHaveLength(3);
  });
});
