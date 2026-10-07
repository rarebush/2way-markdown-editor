import type { WorkspaceDocument } from "./documents";

type SaveCallbacks = {
  onSaved?: () => void;
  onError?: () => void;
};

type PendingSave = {
  document: WorkspaceDocument;
  timer: ReturnType<typeof setTimeout>;
  callbacks: SaveCallbacks;
};

export function createDocumentSaveScheduler(
  save: (document: WorkspaceDocument) => Promise<void>,
  delayMs = 350,
) {
  const pending = new Map<string, PendingSave>();
  const inFlight = new Map<string, Promise<void>>();

  function persist(document: WorkspaceDocument, callbacks: SaveCallbacks) {
    const previous = inFlight.get(document.id);
    const write = (
      previous ? previous.catch(() => undefined) : Promise.resolve()
    ).then(() => save(document));
    inFlight.set(document.id, write);

    void write.then(callbacks.onSaved, callbacks.onError).finally(() => {
      if (inFlight.get(document.id) === write) inFlight.delete(document.id);
    });

    return write;
  }

  function flush(documentId: string) {
    const entry = pending.get(documentId);
    if (!entry) return inFlight.get(documentId) ?? Promise.resolve();

    clearTimeout(entry.timer);
    pending.delete(documentId);
    return persist(entry.document, entry.callbacks);
  }

  return {
    schedule(document: WorkspaceDocument, callbacks: SaveCallbacks = {}) {
      const existing = pending.get(document.id);
      if (existing) clearTimeout(existing.timer);

      const entry = {} as PendingSave;
      entry.document = document;
      entry.callbacks = callbacks;
      entry.timer = setTimeout(() => {
        if (pending.get(document.id) === entry) void flush(document.id);
      }, delayMs);
      pending.set(document.id, entry);
    },
    async cancel(documentId: string) {
      const entry = pending.get(documentId);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(documentId);
      }
      await inFlight.get(documentId)?.catch(() => undefined);
    },
    async flushAll() {
      await Promise.all([
        ...[...pending.keys()].map(flush),
        ...[...inFlight.values()].map((write) => write.catch(() => undefined)),
      ]);
    },
  };
}
