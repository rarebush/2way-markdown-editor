import { useCallback, useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { withDirectCellEditing } from "./tableInteractions";
import { editorDiagnostics } from "./editorDiagnostics";
import {
  isProgrammaticRichEcho,
  shouldReplaceRichDocument,
  type EditOrigin,
} from "./markdownSync";
import type { RichEditor } from "./richEditorRuntime";
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

const markdownExtensions = [markdownLanguage()];
const markdownBasicSetup = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  autocompletion: false,
};

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

export function MarkdownSurface({
  documentId,
  value,
  origin,
  onChange,
  view,
}: MarkdownSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<RichEditor | null>(null);
  const runtimeRef = useRef<typeof import("./richEditorRuntime") | null>(null);
  const editorReadyRef = useRef(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const expectedRichEchoRef = useRef<string | null>(null);
  const handleSourceChange = useCallback((markdown: string) => {
    if (editorDiagnostics.isEnabled()) {
      editorDiagnostics.record("source-markdown-emitted", {
        length: markdown.length,
      });
    }
    onChangeRef.current(markdown, "source");
  }, []);

  useEffect(() => {
    valueRef.current = value;
    if (editorDiagnostics.isEnabled()) {
      editorDiagnostics.record("shared-markdown-update", {
        length: value.length,
      });
    }
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!rootRef.current) return;

    const root = rootRef.current;
    const recordInteraction = (event: Event) => {
      if (!editorDiagnostics.isEnabled()) return;
      editorDiagnostics.record(`preview-${event.type}`, {
        inputType: event instanceof InputEvent ? event.inputType : null,
        target: event.target instanceof Element ? event.target.tagName : null,
      });
    };
    const eventTypes = [
      "pointerdown",
      "beforeinput",
      "input",
      "compositionstart",
      "compositionend",
      "focusin",
      "focusout",
    ];
    eventTypes.forEach((type) =>
      root.addEventListener(type, recordInteraction, true),
    );

    let crepe: RichEditor | null = null;
    let disposed = false;
    let topBarObserver: MutationObserver | null = null;
    void import("./richEditorRuntime").then(async (runtime) => {
      if (disposed || !rootRef.current) return;
      runtimeRef.current = runtime;
      crepe = runtime.createRichEditor(rootRef.current, valueRef.current);

      crepe.on((listener) => {
        listener.selectionUpdated((ctx, selection) => {
          if (!editorReadyRef.current || !editorDiagnostics.isEnabled()) return;
          editorDiagnostics.record("preview-selection", {
            from: selection.from,
            to: selection.to,
            selectionType: selection.constructor.name,
            focused: ctx.get(runtime.editorViewCtx).hasFocus(),
          });
        });
        listener.markdownUpdated((ctx, markdown) => {
          const expectedEcho = expectedRichEchoRef.current;
          expectedRichEchoRef.current = null;
          if (isProgrammaticRichEcho(markdown, expectedEcho)) {
            if (editorDiagnostics.isEnabled()) {
              editorDiagnostics.record("source-preview-echo-ignored", {
                length: markdown.length,
              });
            }
            return;
          }
          if (editorReadyRef.current && editorDiagnostics.isEnabled())
            editorDiagnostics.record("rich-markdown-emitted", {
              length: markdown.length,
              matchesShared: markdown === valueRef.current,
              matchesLive: markdown === crepe?.getMarkdown(),
              from: ctx.get(runtime.editorViewCtx).state.selection.from,
              to: ctx.get(runtime.editorViewCtx).state.selection.to,
            });
          if (markdown !== valueRef.current)
            onChangeRef.current(markdown, "rich");
        });
      });

      await crepe.create();
      if (disposed) {
        void crepe.destroy();
        return;
      }

      crepeRef.current = crepe;
      editorReadyRef.current = true;
      crepe.editor.action((ctx) => {
        const view = ctx.get(runtime.editorViewCtx);
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
        expectedRichEchoRef.current = runtime.replaceRichMarkdown(
          crepe,
          latestValue,
          "initialization",
        );
      }
    });

    return () => {
      disposed = true;
      eventTypes.forEach((type) =>
        root.removeEventListener(type, recordInteraction, true),
      );
      topBarObserver?.disconnect();
      if (crepe && crepeRef.current === crepe) {
        crepeRef.current = null;
        runtimeRef.current = null;
        editorReadyRef.current = false;
        void crepe.destroy();
      }
    };
  }, [documentId]);

  useEffect(() => {
    const crepe = crepeRef.current;
    if (!editorReadyRef.current || !crepe) return;

    if (origin === "rich") {
      if (editorDiagnostics.isEnabled()) {
        editorDiagnostics.record("rich-replacement-skipped", {
          richOrigin: true,
        });
      }
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (!editorReadyRef.current || crepeRef.current !== crepe) return;
      if (!shouldReplaceRichDocument(origin, value, crepe.getMarkdown()))
        return;

      const expectedEcho = runtimeRef.current?.replaceRichMarkdown(
        crepe,
        value,
        "shared-value-effect",
      );
      if (expectedEcho !== undefined)
        expectedRichEchoRef.current = expectedEcho;
    }, 50);

    return () => window.clearTimeout(timeoutId);
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
          extensions={markdownExtensions}
          onChange={handleSourceChange}
          basicSetup={markdownBasicSetup}
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
