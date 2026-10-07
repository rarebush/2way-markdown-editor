type DiagnosticEvent = {
  elapsedMs: number;
  event: string;
  details: Record<string, string | number | boolean | null>;
};

export function createEditorDiagnostics(limit = 1000) {
  const capacity = Math.max(1, Math.floor(limit));
  let enabled = false;
  let startedAt = 0;
  let events: Array<DiagnosticEvent | undefined> = Array(capacity);
  let eventCount = 0;
  let nextEventIndex = 0;
  let droppedEvents = 0;

  return {
    start() {
      events = Array(capacity);
      eventCount = 0;
      nextEventIndex = 0;
      droppedEvents = 0;
      startedAt = performance.now();
      enabled = true;
      return "Editor diagnostics started (document text is not recorded).";
    },
    stop() {
      enabled = false;
      return "Editor diagnostics stopped.";
    },
    isEnabled() {
      return enabled;
    },
    record(event: string, details: DiagnosticEvent["details"] = {}) {
      if (!enabled) return;
      events[nextEventIndex] = {
        elapsedMs: Math.round(performance.now() - startedAt),
        event,
        details,
      };
      nextEventIndex = (nextEventIndex + 1) % capacity;
      if (eventCount < capacity) {
        eventCount += 1;
      } else {
        droppedEvents += 1;
      }
    },
    export() {
      const startIndex = eventCount === capacity ? nextEventIndex : 0;
      const chronologicalEvents = Array.from(
        { length: eventCount },
        (_, index) => events[(startIndex + index) % capacity]!,
      );
      return JSON.stringify(
        { version: 1, enabled, droppedEvents, events: chronologicalEvents },
        null,
        2,
      );
    },
    mark() {
      this.record("user-reported-caret-jump");
    },
  };
}

export const editorDiagnostics = createEditorDiagnostics();

declare global {
  interface Window {
    draftDiagnostics: typeof editorDiagnostics;
  }
}

if (typeof window !== "undefined") {
  window.draftDiagnostics = editorDiagnostics;
}
