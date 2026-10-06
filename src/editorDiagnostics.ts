type DiagnosticEvent = {
  elapsedMs: number;
  event: string;
  details: Record<string, string | number | boolean | null>;
};

export function createEditorDiagnostics(limit = 1000) {
  let enabled = false;
  let startedAt = 0;
  let events: DiagnosticEvent[] = [];
  let droppedEvents = 0;

  return {
    start() {
      events = [];
      droppedEvents = 0;
      startedAt = performance.now();
      enabled = true;
      return "Editor diagnostics started (document text is not recorded).";
    },
    stop() {
      enabled = false;
      return "Editor diagnostics stopped.";
    },
    record(event: string, details: DiagnosticEvent["details"] = {}) {
      if (!enabled) return;
      events.push({ elapsedMs: Math.round(performance.now() - startedAt), event, details });
      if (events.length > limit) {
        events.shift();
        droppedEvents += 1;
      }
    },
    export() {
      return JSON.stringify({ version: 1, enabled, droppedEvents, events }, null, 2);
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