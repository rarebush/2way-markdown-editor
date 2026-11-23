// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  remarkCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { findScrollBlock, mapScrollBlocks, revealBlock } from "./blockScrollSync";

let editor: Editor | undefined;

afterEach(async () => {
  await editor?.destroy();
  editor = undefined;
  document.body.replaceChildren();
});

async function setup(markdown: string) {
  const root = document.createElement("div");
  document.body.append(root);
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm)
    .create();
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const map = (source: string) =>
      mapScrollBlocks(
        source,
        ctx.get(remarkCtx),
        view.state.schema,
        view.state.doc,
      );
    return { blocks: map(markdown), map, view };
  });
}

describe("block scroll mapping", () => {
  it("maps nested lists, quotes, GFM tables, and fences as whole blocks", async () => {
    const parts = [
      "# Heading",
      "A **bold** paragraph.",
      "- [x] First\n  - Nested\n- Second",
      "> Quoted\n>\n> paragraph",
      "| A | B |\n| --- | --- |\n| one | two |",
      "```md\n# not a heading\n\nstill code\n```",
      "Last paragraph",
    ];
    const markdown = parts.join("\n\n");
    const { blocks, view } = await setup(markdown);
    expect(blocks.map((block) =>
      markdown.slice(block.sourceFrom, block.sourceTo),
    )).toEqual(parts);
    blocks.forEach((block, index) => {
      expect(view.state.doc.nodeAt(block.richFrom)).toBe(
        view.state.doc.child(index),
      );
      expect(findScrollBlock(blocks, block.sourceTo - 1, "source")).toBe(block);
      expect(findScrollBlock(blocks, block.richTo - 1, "rich")).toBe(block);
    });
  });

  it("does not shift later blocks when reference definitions are removed", async () => {
    const markdown = "[ref]: https://example.com\n\n[Link][ref]\n\n## End";
    const { blocks } = await setup(markdown);
    expect(blocks.map((block) =>
      markdown.slice(block.sourceFrom, block.sourceTo),
    )).toEqual(["[Link][ref]", "## End"]);
    expect(findScrollBlock(blocks, markdown.indexOf("End"), "source")).toBe(
      blocks[1],
    );
  });

  it("uses nearby blocks for blank lines, boundaries, and trailing typing space", async () => {
    const markdown = "\n\nFirst\n\n\nSecond\n\n";
    const { blocks, view } = await setup(markdown);
    expect(findScrollBlock(blocks, 0, "source")).toBe(blocks[0]);
    expect(findScrollBlock(blocks, markdown.indexOf("\n\n\n") + 1, "source"))
      .toBe(blocks[0]);
    expect(findScrollBlock(blocks, blocks[1].sourceFrom, "source"))
      .toBe(blocks[1]);
    expect(findScrollBlock(blocks, view.state.doc.content.size, "rich"))
      .toBe(blocks[1]);
  });

  it("does not scroll against a stale rendered document", async () => {
    const { map } = await setup("# Old\n\nParagraph");
    expect(map("# New heading\n\nParagraph")).toEqual([]);
    expect(map("# Old")).toEqual([]);
  });

  it("handles empty documents without inventing a rendered target", async () => {
    const { blocks } = await setup("");
    expect(blocks).toEqual([]);
    expect(findScrollBlock(blocks, 0, "source")).toBeUndefined();
  });

  it("maps a document larger than 10,000 characters", async () => {
    const markdown = Array.from(
      { length: 250 },
      (_, index) => `Paragraph ${index} with **formatting** and some additional text.`,
    ).join("\n\n");
    expect(markdown.length).toBeGreaterThan(10_000);
    const { blocks } = await setup(markdown);
    expect(blocks).toHaveLength(250);
    expect(findScrollBlock(blocks, markdown.length, "source")).toBe(blocks[249]);
  });
});

describe("revealing a preview block", () => {
  it("scrolls only the pane, and leaves visible or overlapping blocks alone", () => {
    const container = document.createElement("div");
    const rect = (top: number, bottom: number) =>
      ({ top, bottom } as DOMRect);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(100, 500));
    revealBlock(container, rect(700, 760));
    expect(container.scrollTop).toBe(584);

    revealBlock(container, rect(150, 200));
    expect(container.scrollTop).toBe(584);
    revealBlock(container, rect(50, 900));
    expect(container.scrollTop).toBe(584);

    revealBlock(container, rect(20, 60));
    expect(container.scrollTop).toBe(488);
  });
});
