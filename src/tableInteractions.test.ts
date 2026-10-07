import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeViewConstructor, EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { withDirectCellEditing } from "./tableInteractions";

afterEach(() => vi.unstubAllGlobals());

function setup(editable = true) {
  const browser = new JSDOM(
    "<table><tbody><tr><td><p>Cell text</p><button>Action</button></td></tr></tbody></table>",
  );
  vi.stubGlobal("Element", browser.window.Element);
  vi.stubGlobal("MouseEvent", browser.window.MouseEvent);
  const contentDOM = browser.window.document.querySelector("tbody")!;
  const originalStopEvent = vi.fn(() => true);
  const constructor: NodeViewConstructor = () => ({
    dom: contentDOM.parentElement!,
    contentDOM,
    stopEvent: originalStopEvent,
  });
  const nodeView = withDirectCellEditing(constructor)(
    {} as ProseMirrorNode,
    { editable } as EditorView,
    () => 0,
    [],
    {} as Parameters<NodeViewConstructor>[4],
  );
  const result: boolean[] = [];
  contentDOM.addEventListener("mousedown", (event) =>
    result.push(nodeView.stopEvent!(event)),
  );
  contentDOM.addEventListener("pointerdown", (event) =>
    result.push(nodeView.stopEvent!(event)),
  );
  return { browser, contentDOM, nodeView, originalStopEvent, result };
}

describe("direct table cell editing", () => {
  it.each(["mousedown", "pointerdown"])(
    "lets plain %s reach normal text selection without calling the deferred handler",
    (type) => {
      const { browser, contentDOM, originalStopEvent, result } = setup();
      contentDOM
        .querySelector("p")!
        .dispatchEvent(
          new browser.window.MouseEvent(type, { bubbles: true, button: 0 }),
        );
      expect(result).toEqual([false]);
      expect(originalStopEvent).not.toHaveBeenCalled();
    },
  );

  it("preserves modifier-click and table button handling", () => {
    const { browser, contentDOM, originalStopEvent, result } = setup();
    contentDOM
      .querySelector("p")!
      .dispatchEvent(
        new browser.window.MouseEvent("mousedown", {
          bubbles: true,
          shiftKey: true,
        }),
      );
    contentDOM
      .querySelector("button")!
      .dispatchEvent(
        new browser.window.MouseEvent("mousedown", { bubbles: true }),
      );
    expect(result).toEqual([true, true]);
    expect(originalStopEvent).toHaveBeenCalledTimes(2);
  });

  it("preserves drag and readonly behavior", () => {
    const { browser, contentDOM, nodeView, originalStopEvent, result } =
      setup(false);
    contentDOM
      .querySelector("p")!
      .dispatchEvent(
        new browser.window.MouseEvent("mousedown", { bubbles: true }),
      );
    expect(result).toEqual([true]);
    expect(nodeView.stopEvent!(new browser.window.Event("dragstart"))).toBe(
      true,
    );
    expect(originalStopEvent).toHaveBeenCalledTimes(2);
  });
});
