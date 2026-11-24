// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { editorViewCtx, parserCtx } from "@milkdown/kit/core";
import type { Node } from "@milkdown/kit/prose/model";
import {
  createRichEditor,
  formatRichMarkdown,
  setRichFormatting,
} from "./richEditorRuntime";
import { defaultFormattingPreferences } from "./formattingPreferences";

describe("rich Markdown formatting preferences", () => {
  it("updates serialization without replacing the editor document", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const source = "# Heading\n\n---\n\n- item\n\n*emphasis* and **strong**\n";
    const editor = createRichEditor(root, source);
    try {
      await editor.create();
      const before = editor.getMarkdown();
      expect(formatRichMarkdown(editor, source)).toBe(before);
      setRichFormatting(editor, {
        rule: "-",
        bullet: "-",
        emphasis: "_",
        headings: "setext",
      });
      const formatted = editor.getMarkdown();
      expect(formatted).toContain("Heading\n=======");
      expect(formatted).toContain("\n---\n");
      expect(formatted).toContain("- item");
      expect(formatted).toContain("_emphasis_ and __strong__");
      expect(formatRichMarkdown(editor, source)).toBe(formatted);

      setRichFormatting(editor, defaultFormattingPreferences);
      expect(editor.getMarkdown()).toBe(before);
    } finally {
      await editor.destroy();
      root.remove();
    }
  });

  it("preserves nested emphasis semantics when selecting a marker", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createRichEditor(root, "*outer **inner** text*\n");
    try {
      await editor.create();
      setRichFormatting(editor, { ...defaultFormattingPreferences, emphasis: "_" });
      const formatted = editor.getMarkdown();
      editor.editor.action((ctx) => {
        const parsed = ctx.get(parserCtx)(formatted);
        expect(parsed).not.toBeNull();
        const runs = (doc: Node) => {
          const result: { text: string | undefined; marks: string[] }[] = [];
          doc.descendants((node) => {
            if (node.isText)
              result.push({ text: node.text, marks: node.marks.map((mark) => mark.type.name) });
          });
          return result;
        };
        expect(runs(parsed!)).toEqual(runs(ctx.get(editorViewCtx).state.doc));
      });
    } finally {
      await editor.destroy();
      root.remove();
    }
  });
});
