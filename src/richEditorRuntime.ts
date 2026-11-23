import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, remarkCtx } from "@milkdown/kit/core";
import type { Node } from "@milkdown/kit/prose/model";
import { replaceAll } from "@milkdown/kit/utils";
import { editorDiagnostics } from "./editorDiagnostics";
import {
  findScrollBlock,
  mapScrollBlocks,
  revealBlock,
  type ScrollBlock,
} from "./blockScrollSync";
import type { EditOrigin } from "./markdownSync";
import type { EditorView } from "@uiw/react-codemirror";

export type RichEditor = Crepe;

const scrollMaps = new WeakMap<
  RichEditor,
  { markdown: string; document: Node; blocks: ScrollBlock[] }
>();

export function getScrollBlock(
  crepe: RichEditor,
  markdown: string,
  origin: EditOrigin,
  sourceHead: number,
) {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (origin === "rich" && view.composing) return undefined;
    let cached = scrollMaps.get(crepe);
    if (cached?.markdown !== markdown || cached.document !== view.state.doc) {
      cached = {
        markdown,
        document: view.state.doc,
        blocks: mapScrollBlocks(
          markdown,
          ctx.get(remarkCtx),
          view.state.schema,
          view.state.doc,
        ),
      };
      scrollMaps.set(crepe, cached);
    }
    return findScrollBlock(
      cached.blocks,
      origin === "source" ? sourceHead : view.state.selection.head,
      origin,
    );
  });
}

export function revealRichBlock(crepe: RichEditor, position: number) {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const node = view.nodeDOM(position);
    const container = view.dom.closest<HTMLElement>(".rich-editor-scroll");
    if (container && node instanceof HTMLElement) {
      revealBlock(container, node.getBoundingClientRect());
    }
  });
}

export function revealSourceBlock(source: EditorView, position: number) {
  source.requestMeasure({
    key: revealSourceBlock,
    read: (view) => {
      const line = view.lineBlockAt(position);
      return {
        top: view.documentTop + line.top,
        bottom: view.documentTop + line.bottom,
      };
    },
    write: (rect, view) => revealBlock(view.scrollDOM, rect),
  });
}

export function createRichEditor(root: HTMLElement, defaultValue: string) {
  return new Crepe({
    root,
    defaultValue,
    features: {
      [Crepe.Feature.TopBar]: true,
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.CodeMirror]: false,
    },
    featureConfigs: {
      [Crepe.Feature.Cursor]: { virtual: false },
    },
  });
}

export function replaceRichMarkdown(
  crepe: RichEditor,
  markdown: string,
  reason: string,
) {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (editorDiagnostics.isEnabled()) {
      editorDiagnostics.record("replace-all-before", {
        reason,
        length: markdown.length,
        from: view.state.selection.from,
        to: view.state.selection.to,
        focused: view.hasFocus(),
      });
    }
    replaceAll(markdown)(ctx);
    if (editorDiagnostics.isEnabled()) {
      editorDiagnostics.record("replace-all-after", {
        from: view.state.selection.from,
        to: view.state.selection.to,
        focused: view.hasFocus(),
      });
    }
  });
  return crepe.getMarkdown();
}

export { editorViewCtx };
