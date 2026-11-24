import { Crepe } from "@milkdown/crepe";
import {
  editorViewCtx,
  parserCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import { EditorState } from "@milkdown/kit/prose/state";
import { fixTables } from "@milkdown/kit/prose/tables";
import { liftTarget } from "@milkdown/kit/prose/transform";
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
import {
  defaultFormattingPreferences,
  type FormattingPreferences,
} from "./formattingPreferences";

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

export function createRichEditor(
  root: HTMLElement,
  defaultValue: string,
  preferences: FormattingPreferences = defaultFormattingPreferences,
) {
  const crepe = new Crepe({
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
      [Crepe.Feature.TopBar]: {
        buildTopBar: (builder) => {
          for (const group of builder.build()) {
            for (const item of group.items) {
              const original = item.onRun;
              if (!original) continue;
              if (group.key === "list" && (
                item.key === "bullet-list" ||
                item.key === "ordered-list" ||
                item.key === "task-list"
              )) {
                const listKind = item.key;
                item.onRun = (ctx) => {
                  if (!toggleListOff(ctx, listKind)) original(ctx);
                };
              } else if (group.key === "more" && item.key === "quote") {
                item.onRun = (ctx) => {
                  if (!toggleQuoteOff(ctx)) original(ctx);
                };
              }
            }
          }
        },
      },
    },
  });
  crepe.editor.config((ctx) => {
    const options = ctx.get(remarkStringifyOptionsCtx);
    originalHandlers.set(crepe, options.handlers);
    configureOptions(options, options.handlers, preferences);
  });
  return crepe;
}

function toggleListOff(ctx: Ctx, kind: "bullet-list" | "ordered-list" | "task-list") {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const matches = (position: typeof state.selection.$from) => {
    for (let depth = position.depth; depth > 0; depth--) {
      const node = position.node(depth);
      if (node.type !== state.schema.nodes.list_item) continue;
      const list = position.node(depth - 1);
      if (kind === "task-list") return node.attrs.checked != null;
      return node.attrs.checked == null && list.type.name === (
        kind === "bullet-list" ? "bullet_list" : "ordered_list"
      );
    }
    return false;
  };
  if (!matches(state.selection.$from) || !matches(state.selection.$to)) return false;
  liftListItem(state.schema.nodes.list_item)(state, view.dispatch);
  return true;
}

function toggleQuoteOff(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, (node) => node.type === state.schema.nodes.blockquote);
  if (!range) return false;
  const target = liftTarget(range);
  if (target !== null) view.dispatch(state.tr.lift(range, target));
  return true;
}

type StringifyOptions = ReturnType<typeof remarkStringifyOptionsCtx._typeInfo>;

const originalHandlers = new WeakMap<RichEditor, StringifyOptions["handlers"]>();

function configureOptions(
  options: StringifyOptions,
  handlers: StringifyOptions["handlers"],
  preferences: FormattingPreferences,
) {
  options.rule = preferences.rule;
  options.bullet = preferences.bullet;
  options.setext = preferences.headings === "setext";
  if (preferences.emphasis === "preserve") {
    delete options.emphasis;
    delete options.strong;
    options.handlers = handlers;
  } else {
    options.emphasis = preferences.emphasis;
    options.strong = preferences.emphasis;
    const adjusted = { ...handlers };
    delete adjusted.emphasis;
    delete adjusted.strong;
    options.handlers = adjusted;
  }
}

export function setRichFormatting(crepe: RichEditor, preferences: FormattingPreferences) {
  crepe.editor.action((ctx) => {
    configureOptions(
      ctx.get(remarkStringifyOptionsCtx),
      originalHandlers.get(crepe),
      preferences,
    );
  });
}

export function formatRichMarkdown(crepe: RichEditor, markdown: string) {
  return crepe.editor.action((ctx) => {
    const parsed = ctx.get(parserCtx)(markdown);
    if (!parsed) throw new Error("The Markdown could not be parsed.");
    const state = EditorState.create({ doc: parsed });
    const normalized = fixTables(state)?.doc ?? parsed;
    return ctx.get(serializerCtx)(normalized);
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
