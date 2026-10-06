import { useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/kit/utils";
import { editorViewCtx } from "@milkdown/kit/core";
import { withDirectCellEditing } from "./tableInteractions";
import { editorDiagnostics } from "./editorDiagnostics";
import { shouldReplaceRichDocument, type EditOrigin } from "./markdownSync";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

type MarkdownSurfaceProps = {
  documentId: string;
  value: string;
  onChange: (value: string, origin: EditOrigin) => void;
  origin?: EditOrigin;
  view: "split" | "source" | "rendered";
};

const topBarToolLabels = [
  "Bold",
  "Italic",
  "Strikethrough",
  "Inline code",
  "Bullet list",
  "Numbered list",
  "Task list",
  "Link",
  "Table",
  "Code block",
  "Quote",
  "Horizontal rule",
];

function labelTopBarControls(root: HTMLElement) {
  const topBar = root.querySelector<HTMLElement>(".milkdown-top-bar");
  if (!topBar) return;

  const headingSelector = topBar.querySelector<HTMLButtonElement>(
    ".top-bar-heading-button",
  );
  if (headingSelector) {
    headingSelector.title = "Text style";
    headingSelector.setAttribute("aria-label", "Text style");
  }

  topBar
    .querySelectorAll<HTMLButtonElement>(".top-bar-item")
    .forEach((button, index) => {
      const label = topBarToolLabels[index];
      if (!label) return;

      button.title = label;
      button.setAttribute("aria-label", label);
    });
}

function replaceRichMarkdown(crepe: Crepe, markdown: string, reason: string) {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    editorDiagnostics.record("replace-all-before", {
      reason,
      length: markdown.length,
      from: view.state.selection.from,
      to: view.state.selection.to,
      focused: view.hasFocus(),
    });
    replaceAll(markdown)(ctx);
    editorDiagnostics.record("replace-all-after", {
      from: view.state.selection.from,
      to: view.state.selection.to,
      focused: view.hasFocus(),
    });
  });
}

export function MarkdownSurface({
  documentId,
  value,
  origin,
  onChange,
  view,
}: MarkdownSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const editorReadyRef = useRef(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
    editorDiagnostics.record("shared-markdown-update", { length: value.length });
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!rootRef.current) return;

    const root = rootRef.current;
    const recordInteraction = (event: Event) => {
      editorDiagnostics.record(`preview-${event.type}`, {
        inputType: event instanceof InputEvent ? event.inputType : null,
        target: event.target instanceof Element ? event.target.tagName : null,
      });
    };
    const eventTypes = ["pointerdown", "beforeinput", "input", "compositionstart", "compositionend", "focusin", "focusout"];
    eventTypes.forEach((type) => root.addEventListener(type, recordInteraction, true));

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: valueRef.current,
      features: {
        [Crepe.Feature.TopBar]: true,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.CodeMirror]: false,
      },
    });

    crepe.on((listener) => {
      listener.selectionUpdated((ctx, selection) => {
        if (!editorReadyRef.current) return;
        editorDiagnostics.record("preview-selection", {
          from: selection.from,
          to: selection.to,
          selectionType: selection.constructor.name,
          focused: ctx.get(editorViewCtx).hasFocus(),
        });
      });
      listener.markdownUpdated((ctx, markdown) => {
        if (editorReadyRef.current) editorDiagnostics.record("rich-markdown-emitted", {
          length: markdown.length,
          matchesShared: markdown === valueRef.current,
          matchesLive: markdown === crepe.getMarkdown(),
          from: ctx.get(editorViewCtx).state.selection.from,
          to: ctx.get(editorViewCtx).state.selection.to,
        });
        if (markdown !== valueRef.current) onChangeRef.current(markdown, "rich");
      });
    });

    let disposed = false;
    let topBarObserver: MutationObserver | null = null;
    void crepe.create().then(() => {
      if (disposed) {
        void crepe.destroy();
        return;
      }

      crepeRef.current = crepe;
      editorReadyRef.current = true;
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.someProp("nodeViews", (nodeViews) => {
          if (!nodeViews.table) return false;
          view.setProps({
            nodeViews: {
              ...view.props.nodeViews,
              table: withDirectCellEditing(nodeViews.table),
            },
          });
          return true;
        });
      });
      if (rootRef.current) {
        labelTopBarControls(rootRef.current);
        const topBar = rootRef.current.querySelector(".milkdown-top-bar");
        if (topBar) {
          topBarObserver = new MutationObserver(() => {
            if (rootRef.current) labelTopBarControls(rootRef.current);
          });
          topBarObserver.observe(topBar, { childList: true, subtree: true });
        }
      }
      const latestValue = valueRef.current;
      if (crepe.getMarkdown() !== latestValue) {
        replaceRichMarkdown(crepe, latestValue, "initialization");
      }
    });

    return () => {
      disposed = true;
      eventTypes.forEach((type) => root.removeEventListener(type, recordInteraction, true));
      topBarObserver?.disconnect();
      if (crepeRef.current === crepe) {
        crepeRef.current = null;
        editorReadyRef.current = false;
        void crepe.destroy();
      }
    };
  }, [documentId]);

  useEffect(() => {
    const crepe = crepeRef.current;
    if (!editorReadyRef.current || !crepe)
      return;

    if (!shouldReplaceRichDocument(origin, value, crepe.getMarkdown())) {
      editorDiagnostics.record("rich-replacement-skipped", {
        richOrigin: origin === "rich",
      });
      return;
    }

    replaceRichMarkdown(crepe, value, "shared-value-effect");
  }, [value, origin]);

  return (
    <div className={`editor-surfaces editor-surfaces--${view}`}>
      <section
        className={`editor-pane source-pane ${view === "rendered" ? "pane-hidden" : ""}`}
        aria-label="Markdown source editor"
        aria-hidden={view === "rendered"}
      >
        <div className="pane-heading">
          <h2>Markdown</h2>
          <span className="pane-format">.MD</span>
        </div>
        <CodeMirror
          value={value}
          height="100%"
          extensions={[markdownLanguage()]}
          onChange={(markdown) => {
            editorDiagnostics.record("source-markdown-emitted", { length: markdown.length });
            onChange(markdown, "source");
          }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            autocompletion: false,
          }}
          aria-label="Markdown source"
        />
      </section>
      <section
        className={`editor-pane rendered-pane ${view === "source" ? "pane-hidden" : ""}`}
        aria-label="Rendered Markdown editor"
        aria-hidden={view === "source"}
      >
        <div className="pane-heading">
          <h2>Preview</h2>
          <span className="pane-format">LIVE</span>
        </div>
        <div className="rich-editor-scroll">
          <div ref={rootRef} className="rich-editor-root" />
        </div>
      </section>
    </div>
  );
}
