import { useEffect, useRef, useState } from "react";
import {
  BookOpenText,
  Check,
  Columns2,
  Code2,
  Download,
  Eye,
  FileInput,
  FilePlus2,
  FileText,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { MarkdownSurface } from "./MarkdownSurface";
import type { EditOrigin } from "./markdownSync";
import {
  createDocument,
  deleteDocument,
  listDocuments,
  saveDocument,
  type WorkspaceDocument,
} from "./documents";
import "./App.css";

type ViewMode = "split" | "source" | "rendered";
type DialogMode = "new" | "rename" | null;

const starterMarkdown = [
  "# A thought, in two directions",
  "",
  "This is your writing space. Edit the **Markdown** on the left, or work directly in the formatted page on the right. Both stay in sync.",
  "",
  "## A small field guide",
  "",
  "| Element | Markdown | Result |",
  "| :-- | :-- | :-- |",
  "| Emphasis | **bold** | **bold** |",
  "| A link | [W3C](https://www.w3.org) | [W3C](https://www.w3.org) |",
  "| A task | checklist | complete |",
  "",
  "### Make a list",
  "",
  "- [x] Capture the idea",
  "- [ ] Find its shape",
  "- [ ] Give it a title",
  "",
  "> Good writing begins with a mark on the page.",
  "",
  "Try a fenced code block:",
  "",
  "```ts",
  "const direction = 'both'",
  "```",
].join("\n");

function App() {
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [activeId, setActiveId] = useState("");
  const [lastEdit, setLastEdit] = useState<{
    documentId: string;
    content: string;
    origin: EditOrigin;
  } | null>(null);
  const [view, setView] = useState<ViewMode>("split");
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [documentName, setDocumentName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const activeDocument = documents.find((document) => document.id === activeId);

  useEffect(() => {
    let mounted = true;

    void listDocuments()
      .then(async (storedDocuments) => {
        if (!mounted) return;
        const availableDocuments = storedDocuments.length
          ? storedDocuments
          : [createDocument("Field notes", starterMarkdown)];

        if (!storedDocuments.length) await saveDocument(availableDocuments[0]);
        if (!mounted) return;

        setDocuments(availableDocuments);
        setActiveId(availableDocuments[0].id);
        setReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        const fallback = createDocument("Field notes", starterMarkdown);
        setDocuments([fallback]);
        setActiveId(fallback.id);
        setReady(true);
        setSaveState("error");
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !activeDocument) return;

    const timeoutId = window.setTimeout(() => {
      void saveDocument(activeDocument)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [activeDocument, ready]);

  function updateContent(content: string, origin: EditOrigin) {
    setLastEdit({ documentId: activeId, content, origin });
    setSaveState("saving");
    setDocuments((current) =>
      current.map((document) =>
        document.id === activeId
          ? { ...document, content, updatedAt: Date.now() }
          : document,
      ),
    );
  }

  function openNewDocument() {
    setDocumentName("Untitled");
    setDialogMode("new");
  }

  async function submitDocumentDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = documentName.trim();
    if (!trimmedName) return;

    if (dialogMode === "new") {
      setSaveState("saving");
      const createdDocument = createDocument(trimmedName, "");
      await saveDocument(createdDocument);
      setDocuments((current) => [createdDocument, ...current]);
      setActiveId(createdDocument.id);
    } else if (dialogMode === "rename" && activeDocument) {
      setSaveState("saving");
      const renamedDocument = {
        ...activeDocument,
        name: trimmedName,
        updatedAt: Date.now(),
      };
      setDocuments((current) =>
        current.map((document) =>
          document.id === renamedDocument.id ? renamedDocument : document,
        ),
      );
      await saveDocument(renamedDocument);
    }

    setDialogMode(null);
  }

  async function removeActiveDocument() {
    if (!activeDocument) return;
    setSaveState("saving");
    await deleteDocument(activeDocument.id);
    const remaining = documents.filter(
      (document) => document.id !== activeDocument.id,
    );

    if (remaining.length) {
      setDocuments(remaining);
      setActiveId(remaining[0].id);
    } else {
      const replacement = createDocument("Field notes", starterMarkdown);
      await saveDocument(replacement);
      setDocuments([replacement]);
      setActiveId(replacement.id);
    }

    setShowDeleteConfirm(false);
  }

  function exportDocument() {
    if (!activeDocument) return;
    const blob = new Blob([activeDocument.content], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeDocument.name.replace(/[\\/:*?"<>|]/g, "-").trim() || "document"}.md`;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importDocument(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const importedName = file.name.replace(/\.(md|markdown|mdown|mkd)$/i, "");
    const baseName = importedName || "Imported document";
    const existingNames = new Set(
      documents.map((document) => document.name.toLocaleLowerCase()),
    );
    let uniqueName = baseName;
    let suffix = 2;
    while (existingNames.has(uniqueName.toLocaleLowerCase())) {
      uniqueName = `${baseName} (${suffix})`;
      suffix += 1;
    }

    const imported = createDocument(uniqueName, await file.text());
    setSaveState("saving");
    await saveDocument(imported);
    setDocuments((current) => [imported, ...current]);
    setActiveId(imported.id);
    event.target.value = "";
  }

  if (!ready) {
    return (
      <main className="loading-screen">
        <span className="loading-mark">
          <BookOpenText size={19} />
        </span>
      </main>
    );
  }

  return (
    <main className="workspace">
      <header className="app-header">
        <a className="brand" href="#workspace" aria-label="Draft home">
          <span className="brand-mark">
            <BookOpenText size={19} strokeWidth={1.8} />
          </span>
          <span className="brand-name">
            Draft<span className="brand-period">.</span>
          </span>
        </a>

        <div className="document-controls">
          <FileText className="document-icon" size={16} />
          <select
            aria-label="Choose a document"
            value={activeId}
            onChange={(event) => setActiveId(event.target.value)}
          >
            {documents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button new-document"
            type="button"
            onClick={openNewDocument}
            aria-label="New document"
            title="New document"
          >
            <Plus size={17} />
          </button>
        </div>

        <div className="header-spacer" />

        <div className="view-switcher" role="group" aria-label="Editor view">
          <button
            className={`view-button ${view === "source" ? "is-active" : ""}`}
            type="button"
            onClick={() => setView("source")}
            aria-label="Markdown only"
            title="Markdown only"
            aria-pressed={view === "source"}
          >
            <Code2 size={16} />
          </button>
          <button
            className={`view-button ${view === "split" ? "is-active" : ""}`}
            type="button"
            onClick={() => setView("split")}
            aria-label="Split view"
            title="Split view"
            aria-pressed={view === "split"}
          >
            <Columns2 size={16} />
          </button>
          <button
            className={`view-button ${view === "rendered" ? "is-active" : ""}`}
            type="button"
            onClick={() => setView("rendered")}
            aria-label="Rendered only"
            title="Rendered only"
            aria-pressed={view === "rendered"}
          >
            <Eye size={16} />
          </button>
        </div>

        <div
          className={`save-indicator save-indicator--${saveState}`}
          aria-live="polite"
        >
          {saveState === "saved" ? (
            <Check size={14} />
          ) : saveState === "saving" ? (
            <Save size={14} />
          ) : (
            <X size={14} />
          )}
          <span>
            {saveState === "saved"
              ? "Saved"
              : saveState === "saving"
                ? "Saving"
                : "Not saved"}
          </span>
        </div>

        <div className="file-actions">
          <input
            ref={importRef}
            className="visually-hidden"
            type="file"
            accept=".md,.markdown,.mdown,.mkd,text/markdown,text/plain"
            onChange={(event) => void importDocument(event)}
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            className="secondary-action"
            type="button"
            onClick={() => importRef.current?.click()}
          >
            <FileInput size={16} />
            <span>Import</span>
          </button>
          <button
            className="primary-action"
            type="button"
            onClick={exportDocument}
          >
            <Download size={16} />
            <span>Export .md</span>
          </button>
        </div>
      </header>

      <section className="document-heading" id="workspace">
        <h1>{activeDocument?.name ?? "Untitled"}</h1>
        <div className="title-actions" aria-label="Document actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              setDocumentName(activeDocument?.name ?? "");
              setDialogMode("rename");
            }}
            aria-label="Rename document"
            title="Rename document"
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button danger-action"
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            aria-label="Delete document"
            title="Delete document"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </section>

      {activeDocument && (
        <MarkdownSurface
          key={activeDocument.id}
          documentId={activeDocument.id}
          value={activeDocument.content}
          origin={lastEdit?.documentId === activeDocument.id && lastEdit.content === activeDocument.content
            ? lastEdit.origin : undefined}
          onChange={updateContent}
          view={view}
        />
      )}

      <footer className="workspace-footer">
        <span>
          <span className="footer-light" />
          Your work is stored in this browser
        </span>
        <span>CommonMark + GFM</span>
      </footer>

      {dialogMode && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogMode(null);
          }}
        >
          <form
            className="dialog"
            onSubmit={(event) => void submitDocumentDialog(event)}
          >
            <div className="dialog-icon">
              <FilePlus2 size={19} />
            </div>
            <h2>{dialogMode === "new" ? "New document" : "Rename document"}</h2>
            <label htmlFor="document-name">Document name</label>
            <input
              id="document-name"
              autoFocus
              value={documentName}
              onChange={(event) => setDocumentName(event.target.value)}
              maxLength={80}
            />
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setDialogMode(null)}
              >
                Cancel
              </button>
              <button className="primary-action" type="submit">
                <Check size={15} />
                {dialogMode === "new" ? "Create" : "Save name"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showDeleteConfirm && activeDocument && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setShowDeleteConfirm(false);
          }}
        >
          <section
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <div className="dialog-icon dialog-icon--danger">
              <Trash2 size={19} />
            </div>
            <h2 id="delete-title">Delete this document?</h2>
            <p>
              <strong>{activeDocument.name}</strong> will be removed from this
              browser.
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Keep document
              </button>
              <button
                className="delete-button"
                type="button"
                onClick={() => void removeActiveDocument()}
              >
                Delete
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
