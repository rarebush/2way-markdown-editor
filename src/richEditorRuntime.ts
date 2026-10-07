import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { replaceAll } from "@milkdown/kit/utils";
import { editorDiagnostics } from "./editorDiagnostics";

export type RichEditor = Crepe;

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
