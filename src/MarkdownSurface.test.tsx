// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { EditorView } from "@uiw/react-codemirror";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownSurface } from "./MarkdownSurface";
import * as runtime from "./richEditorRuntime";

vi.mock("./richEditorRuntime", () => ({
  editorViewCtx: Symbol("editorView"),
  createRichEditor: vi.fn((_root: HTMLElement, markdown: string) => ({
    on: vi.fn(),
    create: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    getMarkdown: () => markdown,
    editor: {
      action: (callback: (ctx: unknown) => void) =>
        callback({ get: () => ({ someProp: vi.fn() }) }),
    },
  })),
  replaceRichMarkdown: vi.fn(),
  getScrollBlock: vi.fn(() => ({
    sourceFrom: 9,
    sourceTo: 15,
    richFrom: 7,
    richTo: 15,
  })),
  revealRichBlock: vi.fn(),
  revealSourceBlock: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () =>
      document.createElement("div").getClientRects();
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Markdown surface scroll synchronization", () => {
  it.each([
    ["LF", "# First\n\nSecond"],
    ["CRLF", "# First\r\n\r\nSecond"],
    ["mixed line endings", "# First\r\n\nSecond"],
    ["CR", "# First\r\rSecond"],
  ])("scrolls an unchanged loaded %s document without rewriting it", async (_name, value) => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownSurface
        documentId="cached-repository-file"
        value={value}
        onChange={onChange}
        view="split"
      />,
    );
    await waitFor(() => expect(runtime.createRichEditor).toHaveBeenCalled());
    const sourceDOM = container.querySelector<HTMLElement>(".cm-content")!;
    const source = EditorView.findFromDOM(sourceDOM)!;
    expect(source.state.doc.toString()).toBe("# First\n\nSecond");
    source.focus();
    source.dispatch({ selection: { anchor: source.state.doc.length } });

    await waitFor(() => expect(runtime.revealRichBlock).toHaveBeenCalled());
    expect(runtime.getScrollBlock).toHaveBeenLastCalledWith(
      expect.anything(),
      "# First\n\nSecond",
      "source",
      source.state.doc.length,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(source.state.selection.main.head).toBe(source.state.doc.length);
  });

  it("still waits when source content differs beyond line endings", async () => {
    const { container } = render(
      <MarkdownSurface
        documentId="cached-repository-file"
        value={"# First\r\n\r\nSecond"}
        onChange={vi.fn()}
        view="split"
      />,
    );
    await waitFor(() => expect(runtime.createRichEditor).toHaveBeenCalled());
    const source = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-content")!,
    )!;
    source.focus();
    source.dispatch({
      changes: { from: source.state.doc.length, insert: " newer" },
      selection: { anchor: source.state.doc.length + 6 },
    });
    await new Promise(window.requestAnimationFrame);
    expect(runtime.getScrollBlock).not.toHaveBeenCalled();
    expect(runtime.revealRichBlock).not.toHaveBeenCalled();
  });
});
