import type { Node, Schema } from "@milkdown/kit/prose/model";
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
  const blocks: ScrollBlock[] = [];
  let nodeIndex = 0;
  let richFrom = 0;

  // Use Milkdown's own transforms: references and HTML need not produce one
  // rendered block per source node.
  for (const child of tree.children ?? []) {
    parser.next(child);
    const nodes = parser.top()!.content;
    while (nodeIndex < nodes.length) {
      const parsed = nodes[nodeIndex];
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
      const richTo = richFrom + parsed.nodeSize;
      const sourceFrom = child.position?.start.offset;
      const sourceTo = child.position?.end.offset;
      if (sourceFrom !== undefined && sourceTo !== undefined) {
        blocks.push({ sourceFrom, sourceTo, richFrom, richTo });
      }
      richFrom = richTo;
      nodeIndex++;
    }
  }
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
