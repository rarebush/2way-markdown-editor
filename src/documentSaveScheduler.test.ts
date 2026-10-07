import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDocument } from "./documents";
import { createDocumentSaveScheduler } from "./documentSaveScheduler";

afterEach(() => vi.useRealTimers());

function createTestDocument(name: string, content: string): WorkspaceDocument {
  return { id: name, name, content, updatedAt: Date.now() };
}

describe("per-document save scheduling", () => {
  it("saves a pending document after switching to another document", async () => {
    vi.useFakeTimers();
    const save = vi
      .fn<(document: WorkspaceDocument) => Promise<void>>()
      .mockResolvedValue(undefined);
    const scheduler = createDocumentSaveScheduler(save, 350);
    const first = createTestDocument("First", "Edited before switching");
    const second = createTestDocument("Second", "Second draft");

    scheduler.schedule(first);
    vi.advanceTimersByTime(100);
    scheduler.schedule(second);
    await vi.advanceTimersByTimeAsync(350);

    expect(save.mock.calls.map(([document]) => document.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it("coalesces edits to the same document and saves its latest content", async () => {
    vi.useFakeTimers();
    const save = vi
      .fn<(document: WorkspaceDocument) => Promise<void>>()
      .mockResolvedValue(undefined);
    const scheduler = createDocumentSaveScheduler(save, 350);
    const firstVersion = createTestDocument("Notes", "A");
    const latestVersion = {
      ...firstVersion,
      content: "AB",
      updatedAt: Date.now(),
    };

    scheduler.schedule(firstVersion);
    vi.advanceTimersByTime(200);
    scheduler.schedule(latestVersion);
    await vi.advanceTimersByTimeAsync(350);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(latestVersion);
  });

  it("waits for an in-flight save before writing the next version", async () => {
    vi.useFakeTimers();
    let finishFirst!: () => void;
    const save = vi
      .fn<(document: WorkspaceDocument) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const scheduler = createDocumentSaveScheduler(save, 10);
    const first = createTestDocument("Notes", "A");
    const latest = { ...first, content: "AB" };

    scheduler.schedule(first);
    await vi.advanceTimersByTimeAsync(10);
    scheduler.schedule(latest);
    await vi.advanceTimersByTimeAsync(10);

    expect(save).toHaveBeenCalledTimes(1);
    finishFirst();
    await scheduler.flushAll();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual(latest);
  });

  it("can cancel a pending write before deleting the document", async () => {
    vi.useFakeTimers();
    const save = vi
      .fn<(document: WorkspaceDocument) => Promise<void>>()
      .mockResolvedValue(undefined);
    const scheduler = createDocumentSaveScheduler(save, 100);
    const document = createTestDocument("Temporary", "Draft");

    scheduler.schedule(document);
    await scheduler.cancel(document.id);
    await vi.advanceTimersByTimeAsync(100);

    expect(save).not.toHaveBeenCalled();
  });
});
