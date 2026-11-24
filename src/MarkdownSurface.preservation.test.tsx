// @vitest-environment jsdom
import { createRef, useState } from "react";
import { EditorView } from "@uiw/react-codemirror";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownSurface, type MarkdownSurfaceHandle } from "./MarkdownSurface";
import * as runtime from "./richEditorRuntime";
import type { EditOrigin } from "./markdownSync";
import { defaultFormattingPreferences } from "./formattingPreferences";

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

function Workspace({ initial, onUpdate }: {
  initial: string;
  onUpdate: (value: string, origin: EditOrigin) => void;
}) {
  const [value, setValue] = useState(initial);
  const [origin, setOrigin] = useState<EditOrigin>();
  return (
    <MarkdownSurface
      documentId="test-document"
      value={value}
      origin={origin}
      view="split"
      onChange={(next, nextOrigin) => {
        onUpdate(next, nextOrigin);
        setOrigin(nextOrigin);
        setValue(next);
      }}
    />
  );
}

describe("preview preservation warning", () => {
  it("rechecks changed preferences and prepares formatting without rewriting source", async () => {
    const source = "First\n\n***\n\nSecond\n";
    const onUpdate = vi.fn();
    const ref = createRef<MarkdownSurfaceHandle>();
    const { rerender } = render(
      <MarkdownSurface
        ref={ref}
        documentId="formatting"
        value={source}
        onChange={onUpdate}
        view="split"
        formatting={defaultFormattingPreferences}
      />,
    );
    await waitFor(() => expect(ref.current?.prepareFormatting(source)).toBe(source));
    rerender(
      <MarkdownSurface
        ref={ref}
        documentId="formatting"
        value={source}
        onChange={onUpdate}
        view="split"
        formatting={{ ...defaultFormattingPreferences, rule: "-" }}
      />,
    );
    await screen.findByRole("button", { name: "Load preview" });
    expect(ref.current?.prepareFormatting(source)).toBe("First\n\n---\n\nSecond\n");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("refuses a formatting review while a preview edit is still pending", async () => {
    const source = "Plain text.\n";
    const createEditor = vi.spyOn(runtime, "createRichEditor");
    const ref = createRef<MarkdownSurfaceHandle>();
    render(
      <MarkdownSurface
        ref={ref}
        documentId="pending-format"
        value={source}
        onChange={vi.fn()}
        view="split"
      />,
    );
    await waitFor(() => expect(ref.current?.prepareFormatting(source)).toBe(source));
    const editor: runtime.RichEditor = createEditor.mock.results[0].value;
    editor.editor.action((ctx) => {
      const view = ctx.get(runtime.editorViewCtx);
      view.dispatch(view.state.tr.insertText("!", 2));
    });
    expect(() => ref.current?.prepareFormatting(source)).toThrow("still synchronizing");
  });

  it.each([
    ["code fence metadata", "```ts title=\"app.ts\"\nconst x = 1;\n```\n"],
    ["formatting only", "Plain text."],
  ])("warns about %s before the source is changed", async (_label, initial) => {
    const onUpdate = vi.fn();
    render(<Workspace initial={initial} onUpdate={onUpdate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load preview" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("allows an unchanged round trip and blocks newly pasted risky Markdown", async () => {
    const onUpdate = vi.fn();
    const { container } = render(<Workspace initial={"Plain text.\n"} onUpdate={onUpdate} />);
    await waitFor(() => expect(container.querySelector(".rich-editor-scroll")?.hasAttribute("inert")).toBe(false));
    const source = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
    source.dispatch({
      changes: { from: 0, insert: "---\ntitle: Test\n---\n\n" },
    });
    await screen.findByRole("button", { name: "Load preview" });
    expect(onUpdate.mock.lastCall?.[0]).toBe("---\ntitle: Test\n---\n\nPlain text.\n");
    expect(onUpdate.mock.calls.every(([, origin]) => origin === "source")).toBe(true);
  });

  it("blocks a lossy document without changing it until the user edits the preview", async () => {
    const initial = "---\ntitle: Test\n---\n\nPlain text.\n";
    const onUpdate = vi.fn();
    const createEditor = vi.spyOn(runtime, "createRichEditor");
    const { container } = render(<Workspace initial={initial} onUpdate={onUpdate} />);

    await screen.findByRole("button", { name: "Load preview" });
    expect(container.querySelector(".rich-editor-scroll")?.hasAttribute("inert")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Load preview" }));
    expect(screen.queryByRole("button", { name: "Load preview" })).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();

    const editor: runtime.RichEditor = createEditor.mock.results[0].value;
    editor.editor.action((ctx) => {
      const view = ctx.get(runtime.editorViewCtx);
      let end = 0;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "Plain text.") end = pos + node.nodeSize;
      });
      expect(end).toBeGreaterThan(0);
      view.dispatch(view.state.tr.insertText("!", end));
    });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(
      expect.stringContaining("Plain text.!"),
      "rich",
    ));
    expect(onUpdate.mock.lastCall?.[0]).not.toMatch(/^---\n/);
  });

  it("rearms for new differences but not an unrelated source edit", async () => {
    const initial = "---\ntitle: Test\n---\n\nPlain text.\n";
    const onUpdate = vi.fn();
    const { container } = render(<Workspace initial={initial} onUpdate={onUpdate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load preview" }));
    const source = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;

    source.dispatch({ changes: { from: source.state.doc.length, insert: "\nAnother paragraph.\n" } });
    await waitFor(() => expect(container.querySelector(".rich-editor-scroll")?.hasAttribute("inert")).toBe(false));
    expect(screen.queryByRole("button", { name: "Load preview" })).toBeNull();

    source.dispatch({ changes: { from: source.state.doc.length, insert: "\n> [!WARNING]\n> Caution.\n" } });
    await screen.findByRole("button", { name: "Load preview" });
    expect(container.querySelector(".rich-editor-scroll")?.hasAttribute("inert")).toBe(true);
    expect(onUpdate.mock.lastCall?.[0]).toContain("> [!WARNING]");
  });
});
