import { describe, expect, it } from "vitest";
import { createEditorDiagnostics } from "./editorDiagnostics";

describe("editor diagnostics", () => {
  it("records only during an explicitly started session", () => {
    const diagnostics = createEditorDiagnostics();
    diagnostics.record("before-start");
    diagnostics.start();
    diagnostics.record("selection", { from: 10, to: 10 });
    diagnostics.mark();
    diagnostics.stop();
    diagnostics.record("after-stop");
    const report = JSON.parse(diagnostics.export());
    expect(report.enabled).toBe(false);
    expect(
      report.events.map((entry: { event: string }) => entry.event),
    ).toEqual(["selection", "user-reported-caret-jump"]);
    expect(report.events[0].details).toEqual({ from: 10, to: 10 });
  });

  it("limits retained events and resets on a new session", () => {
    const diagnostics = createEditorDiagnostics(2);
    diagnostics.start();
    diagnostics.record("first");
    diagnostics.record("second");
    diagnostics.record("third");
    const report = JSON.parse(diagnostics.export());
    expect(report.droppedEvents).toBe(1);
    expect(
      report.events.map((entry: { event: string }) => entry.event),
    ).toEqual(["second", "third"]);
    diagnostics.start();
    expect(JSON.parse(diagnostics.export())).toMatchObject({
      events: [],
      droppedEvents: 0,
    });
  });
});
