import type { Node, Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { fixTables } from "@milkdown/kit/prose/tables";
import {
  ParserState,
  type RemarkParser,
  type MarkdownNode,
} from "@milkdown/kit/transformer";

export type ScrollBlock = {
  sourceFrom: number;
  sourceTo: number;
  richFrom: number;
  richTo: number;
};

export function mapScrollBlocks(
  markdown: string,
  remark: RemarkParser,
  schema: Schema,
  liveDocument: Node,
): ScrollBlock[] {
  const tree = remark.runSync(remark.parse(markdown), markdown) as MarkdownNode;
  const parser = new ParserState(schema).openNode(schema.topNodeType);
  const ranges: {
    sourceFrom: number | undefined;
    sourceTo: number | undefined;
  }[] = [];

  // Use Milkdown's own transforms: references and HTML need not produce one
  // rendered block per source node.
  for (const child of tree.children ?? []) {
    parser.next(child);
    const nodes = parser.top()!.content;
    while (ranges.length < nodes.length) {
      ranges.push({
        sourceFrom: child.position?.start.offset,
        sourceTo: child.position?.end.offset,
      });
    }
  }
  if (!ranges.length) return [];

  // The table-editing plugin repairs uneven rows after a document replacement.
  const parsedDoc = schema.topNodeType.create(null, parser.top()!.content);
  const parsedState = EditorState.create({ doc: parsedDoc });
  const normalizedDoc = fixTables(parsedState)?.doc ?? parsedDoc;
  if (normalizedDoc.childCount !== ranges.length) return [];

  const blocks: ScrollBlock[] = [];
  let richFrom = 0;
  for (let nodeIndex = 0; nodeIndex < ranges.length; nodeIndex++) {
    const parsed = normalizedDoc.child(nodeIndex);
    const live = liveDocument.maybeChild(nodeIndex);
    if (
      !live ||
      live.type !== parsed.type ||
      live.nodeSize !== parsed.nodeSize ||
      live.textContent !== parsed.textContent
    ) {
      // The other editor has not received this Markdown revision yet.
      return [];
    }
    const richTo = richFrom + live.nodeSize;
    const { sourceFrom, sourceTo } = ranges[nodeIndex];
    if (sourceFrom !== undefined && sourceTo !== undefined) {
      blocks.push({ sourceFrom, sourceTo, richFrom, richTo });
    }
    richFrom = richTo;
  }
  const nodeIndex = ranges.length;
  const trailing = liveDocument.maybeChild(nodeIndex);
  if (
    nodeIndex < liveDocument.childCount &&
    !(
      nodeIndex === liveDocument.childCount - 1 &&
      trailing?.type.name === "paragraph" &&
      trailing.content.size === 0
    )
  )
    return [];
  return blocks;
}

export function findScrollBlock(
  blocks: ScrollBlock[],
  position: number,
  origin: "source" | "rich",
) {
  const from = origin === "source" ? "sourceFrom" : "richFrom";
  // Blank source lines and the rich editor's trailing typing paragraph use
  // the preceding block; a leading blank line uses the first block.
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (position >= blocks[index][from]) return blocks[index];
  }
  return blocks[0];
}

export function revealBlock(
  container: HTMLElement,
  rect: Pick<DOMRect, "top" | "bottom">,
) {
  const viewport = container.getBoundingClientRect();
  if (rect.bottom >= viewport.top && rect.top <= viewport.bottom) return;
  container.scrollTop += rect.top - viewport.top - 16;
}
