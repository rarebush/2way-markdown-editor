// @vitest-environment jsdom
import { fireEvent, render, waitFor, cleanup, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import { MarkdownSurface } from "./MarkdownSurface";
import type { EditOrigin } from "./markdownSync";
import * as runtime from "./richEditorRuntime";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => document.createElement("div").getClientRects();
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("preview list toolbar", () => {
  it.each([
    ["Bullet list", "* Text"],
    ["Numbered list", "1. Text"],
    ["Task list", "* [ ] Text"],
    ["Quote", "> Text"],
  ])("toggles %s back to a paragraph", async (label, expected) => {
    const createEditor = vi.spyOn(runtime, "createRichEditor");
    render(
      <MarkdownSurface documentId="test" value={"Text\n"} onChange={vi.fn()} view="split" />,
    );
    const button = await screen.findByRole("button", { name: label });
    const editor: runtime.RichEditor = createEditor.mock.results[0].value;
    await waitFor(() => expect(editor.getMarkdown()).toBe("Text\n"));
    fireEvent.pointerDown(button);
    expect(editor.getMarkdown()).toContain(expected);
    fireEvent.pointerDown(button);
    expect(editor.getMarkdown()).toBe("Text\n");
  });

  it("lifts a nested list item one level without losing its siblings", async () => {
    const createEditor = vi.spyOn(runtime, "createRichEditor");
    render(
      <MarkdownSurface documentId="test" value={"* Parent\n  * Child\n  * Sibling\n"} onChange={vi.fn()} view="split" />,
    );
    const button = await screen.findByRole("button", { name: "Bullet list" });
    const editor: runtime.RichEditor = createEditor.mock.results[0].value;
    selectText(editor, "Child");
    fireEvent.pointerDown(button);
    expect(editor.getMarkdown()).toBe("* Parent\n* Child\n  * Sibling\n");
  });

  it("lifts all selected list items while leaving unselected items alone", async () => {
    const createEditor = vi.spyOn(runtime, "createRichEditor");
    render(
      <MarkdownSurface documentId="test" value={"* First\n* Second\n* Third\n"} onChange={vi.fn()} view="split" />,
    );
    const button = await screen.findByRole("button", { name: "Bullet list" });
    const editor: runtime.RichEditor = createEditor.mock.results[0].value;
    selectText(editor, "First", "Second");
    fireEvent.pointerDown(button);
    expect(editor.getMarkdown()).toBe("First\n\nSecond\n\n* Third\n");
  });

  it("removes a checked task item without changing the next item", async () => {
    const createEditor = vi.spyOn(runtime, "createRichEditor");
    render(
      <MarkdownSurface documentId="test" value={"* [x] Done\n* [ ] Next\n"} onChange={vi.fn()} view="split" />,
    );
    const button = await screen.findByRole("button", { name: "Task list" });
    const editor: runtime.RichEditor = createEditor.mock.results[0].value;
    selectText(editor, "Done");
    fireEvent.pointerDown(button);
    expect(editor.getMarkdown()).toBe("Done\n\n* [ ] Next\n");
  });

  it("removes a quote only from the selected paragraph", async () => {
    const createEditor = vi.spyOn(runtime, "createRichEditor");
    render(
      <MarkdownSurface documentId="test" value={"> First\n>\n> Second\n"} onChange={vi.fn()} view="split" />,
    );
    const button = await screen.findByRole("button", { name: "Quote" });
    const editor: runtime.RichEditor = createEditor.mock.results[0].value;
    selectText(editor, "First");
    fireEvent.pointerDown(button);
    expect(editor.getMarkdown()).toBe("First\n\n> Second\n");
  });

  it("synchronizes both list changes back to Markdown", async () => {
    function Surface() {
      const [markdown, setMarkdown] = useState("Text\n");
      const [origin, setOrigin] = useState<EditOrigin>("source");
      return (
        <>
          <MarkdownSurface documentId="test" value={markdown} origin={origin} onChange={(value, nextOrigin) => {
            setOrigin(nextOrigin);
            setMarkdown(value);
          }} view="split" />
          <output data-testid="markdown">{markdown}</output>
        </>
      );
    }

    render(<Surface />);
    const button = await screen.findByRole("button", { name: "Bullet list" });
    fireEvent.pointerDown(button);
    await waitFor(() => expect(screen.getByTestId("markdown").textContent).toBe("* Text\n"));
    fireEvent.pointerDown(button);
    await waitFor(() => expect(screen.getByTestId("markdown").textContent).toBe("Text\n"));
  });
});

function selectText(editor: runtime.RichEditor, start: string, end = start) {
  editor.editor.action((ctx) => {
    const view = ctx.get(runtime.editorViewCtx);
    let from = -1;
    let to = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === start) from = pos;
      if (node.isText && node.text === end) to = pos + node.nodeSize;
    });
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThanOrEqual(from);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  });
}
