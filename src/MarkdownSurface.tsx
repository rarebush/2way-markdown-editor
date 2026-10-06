import { useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/kit/utils";
import { editorViewCtx } from "@milkdown/kit/core";
import { withDirectCellEditing } from "./tableInteractions";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

type MarkdownSurfaceProps = {
  documentId: string;
  value: string;
  onChange: (value: string) => void;
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

export function MarkdownSurface({
  documentId,
  value,
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
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!rootRef.current) return;

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
      listener.markdownUpdated((_ctx, markdown) => {
        if (markdown !== valueRef.current) onChangeRef.current(markdown);
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
        crepe.editor.action(replaceAll(latestValue));
      }
    });

    return () => {
      disposed = true;
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
    if (!editorReadyRef.current || !crepe || crepe.getMarkdown() === value)
      return;

    crepe.editor.action(replaceAll(value));
  }, [value]);

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
          onChange={onChange}
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
