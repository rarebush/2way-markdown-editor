import { useRef, useState } from "react";
import {
  BookOpenText,
  Check,
  Columns2,
  Code2,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Pencil,
  Trash2,
} from "lucide-react";
import { MarkdownSurface } from "./MarkdownSurface";
import { GitHubWorkspace } from "./GitHubWorkspace";
import { encodeMarkdown, validateMarkdownPath } from "./githubClient";
import { repositoryFilename } from "./githubSync";
import {
  documentRepository,
  type RepositoryWorkspace,
  type WorkspaceDocument,
} from "./documents";
import { inWorkspace, useDocumentWorkspace } from "./useDocumentWorkspace";
import "./App.css";

type ViewMode = "split" | "source" | "rendered";
type DialogMode = "new" | "import" | "rename" | null;
const emptyDocument: WorkspaceDocument = {
  id: "",
  name: "",
  content: "",
  updatedAt: 0,
};

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
  const {
    documents,
    activeDocument,
    space,
    selectedRepository,
    ready,
    saveState,
    editOrigin,
    selectDocument,
    selectWorkspace,
    createDraft,
    updateDocument,
    openGitHubDocument,
    saveLocalCopy,
    importLocalDocument,
    removeDocument,
    updateContent,
  } = useDocumentWorkspace(starterMarkdown);
  const [view, setView] = useState<ViewMode>("split");
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [documentName, setDocumentName] = useState("");
  const [fileRepository, setFileRepository] =
    useState<RepositoryWorkspace | null>(null);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [importContent, setImportContent] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fileActionsTarget, setFileActionsTarget] =
    useState<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importTargetRef = useRef<{
    repository: RepositoryWorkspace | null;
    paths: string[];
  }>({ repository: null, paths: [] });

  const activeId = activeDocument?.id ?? "";
  const newRepositoryPath = filePath ?? repositoryFilename(documentName);
  const pathCollision =
    fileRepository &&
    (filePaths.includes(newRepositoryPath) ||
      documents.some(
        (item) =>
          !(dialogMode === "rename" && item.id === activeId) &&
          inWorkspace(item, "repository", fileRepository) &&
          (item.github?.path ?? item.repositoryPath) === newRepositoryPath,
      ));
  function openNewDocument(
    repository?: RepositoryWorkspace,
    paths: string[] = [],
  ) {
    setDocumentName("Untitled");
    setFileRepository(repository ?? null);
    setFilePaths(paths);
    setFilePath(null);
    setDialogError("");
    setDialogMode("new");
  }

  function openImport(repository?: RepositoryWorkspace, paths: string[] = []) {
    importTargetRef.current = { repository: repository ?? null, paths };
    importRef.current?.click();
  }

  async function submitDocumentDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = documentName.trim();
    if (!trimmedName) return;

    if (dialogMode === "new" || dialogMode === "import") {
      const content = dialogMode === "import" ? importContent : "";
      if (fileRepository) {
        try {
          validateMarkdownPath(newRepositoryPath);
          encodeMarkdown(content);
          if (pathCollision)
            throw new Error(
              `A file already exists at ${newRepositoryPath}. Choose another path; no file will be overwritten.`,
            );
        } catch (error) {
          setDialogError(
            error instanceof Error
              ? error.message
              : "Choose a valid repository path.",
          );
          return;
        }
      }
      try {
        await createDraft(
          trimmedName,
          content,
          fileRepository
            ? { repository: fileRepository, path: newRepositoryPath }
            : undefined,
        );
      } catch {
        setDialogError(
          "The changes could not be saved in this browser. Try again.",
        );
        return;
      }
    } else if (dialogMode === "rename" && activeDocument) {
      if (activeDocument.github) return;
      if (fileRepository) {
        try {
          validateMarkdownPath(newRepositoryPath);
          if (pathCollision)
            throw new Error(
              `A file already exists at ${newRepositoryPath}. Choose another path; no file will be overwritten.`,
            );
        } catch (error) {
          setDialogError(
            error instanceof Error
              ? error.message
              : "Choose a valid repository path.",
          );
          return;
        }
      }
      try {
        await updateDocument(activeDocument.id, (current) => ({
          ...current,
          name: trimmedName,
          updatedAt: Date.now(),
          ...(fileRepository ? { repositoryPath: newRepositoryPath } : {}),
        }));
      } catch {
        setDialogError(
          "The changes could not be saved in this browser. Try again.",
        );
        return;
      }
    }

    setDialogMode(null);
  }

  async function removeDocumentById(id: string) {
    await removeDocument(id);
    setShowDeleteConfirm(false);
  }

  async function removeActiveDocument() {
    if (activeDocument) await removeDocumentById(activeDocument.id);
  }

  function exportDocument() {
    if (!activeDocument) return;
    const blob = new Blob([activeDocument.content], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const repositoryPath =
      activeDocument.github?.path ?? activeDocument.repositoryPath;
    link.download =
      repositoryPath?.split("/").pop() ??
      `${activeDocument.name.replace(/[\\/:*?"<>|]/g, "-").trim() || "document"}.md`;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importDocument(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const target = importTargetRef.current;
    event.target.value = "";

    const importedName = file.name.replace(/\.(md|markdown|mdown|mkd)$/i, "");
    const baseName = importedName || "Imported document";
    const content = await file.text();
    if (target.repository) {
      setDocumentName(baseName);
      setFileRepository(target.repository);
      setFilePaths(target.paths);
      setFilePath(null);
      setImportContent(content);
      setDialogError("");
      setDialogMode("import");
      return;
    }
    await importLocalDocument(baseName, content);
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
      </header>
      <input
        ref={importRef}
        className="visually-hidden"
        type="file"
        accept=".md,.markdown,.mdown,.mkd,text/markdown,text/plain"
        onChange={(event) => void importDocument(event)}
        aria-label="Import Markdown file"
        tabIndex={-1}
      />

      {ready && (
        <div className="workspace-body">
          <GitHubWorkspace
            document={activeDocument ?? emptyDocument}
            documents={documents}
            localSaveState={saveState}
            workspace={space}
            selectedRepository={selectedRepository ?? undefined}
            onWorkspaceChange={selectWorkspace}
            onRepositoryChange={(repository) =>
              selectWorkspace("repository", repository)
            }
            onSelect={selectDocument}
            onNew={openNewDocument}
            onImport={openImport}
            fileActionsTarget={fileActionsTarget}
            onRemoveWorkingCopy={() => setShowDeleteConfirm(true)}
            onSaveLocalCopy={saveLocalCopy}
            onDeleteWorkingCopy={removeDocumentById}
            onOpen={openGitHubDocument}
            onUpdate={updateDocument}
          />
          <section
            className="document-workspace"
            aria-label="Document workspace"
          >
            <section className="document-heading" id="workspace">
              <h1>
                {activeDocument?.name ??
                  (space === "local"
                    ? "Local workspace"
                    : "Repository workspace")}
              </h1>
              <div
                ref={setFileActionsTarget}
                className="title-actions"
                aria-label="Document actions"
              >
                <button
                  className="icon-button"
                  type="button"
                  disabled={!activeDocument}
                  onClick={exportDocument}
                  aria-label="Export Markdown"
                  title="Export Markdown"
                >
                  <Download size={16} />
                </button>
                {!activeDocument?.github && (
                  <button
                    className="icon-button"
                    type="button"
                    disabled={!activeDocument || !!activeDocument.githubPending}
                    onClick={() => {
                      setDocumentName(activeDocument?.name ?? "");
                      setFileRepository(
                        activeDocument
                          ? (documentRepository(activeDocument) ?? null)
                          : null,
                      );
                      setFilePath(activeDocument?.repositoryPath ?? null);
                      setFilePaths([]);
                      setDialogError("");
                      setDialogMode("rename");
                    }}
                    aria-label={
                      activeDocument && documentRepository(activeDocument)
                        ? "Rename draft"
                        : "Rename document"
                    }
                    title={
                      activeDocument && documentRepository(activeDocument)
                        ? "Rename draft"
                        : "Rename document"
                    }
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {!activeDocument?.github && (
                  <button
                    className="icon-button danger-action"
                    type="button"
                    disabled={!activeDocument || !!activeDocument.githubPending}
                    onClick={() => setShowDeleteConfirm(true)}
                    aria-label={
                      activeDocument && documentRepository(activeDocument)
                        ? "Remove working copy"
                        : "Delete document"
                    }
                    title={
                      activeDocument && documentRepository(activeDocument)
                        ? "Remove working copy"
                        : "Delete document"
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </section>
            {activeDocument ? (
              <MarkdownSurface
                key={activeDocument.id}
                documentId={activeDocument.id}
                value={activeDocument.content}
                origin={editOrigin}
                onChange={updateContent}
                view={view}
              />
            ) : (
              <section className="workspace-empty">
                <FileText size={24} />
                <p>
                  {space === "local" ? "No local files" : "No file selected"}
                </p>
              </section>
            )}
          </section>
        </div>
      )}

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
            <h2>
              {dialogMode === "new"
                ? "New file"
                : dialogMode === "import"
                  ? "Import file"
                  : "Rename document"}
            </h2>
            <label htmlFor="document-name">Document name</label>
            <input
              id="document-name"
              autoFocus
              value={documentName}
              onChange={(event) => setDocumentName(event.target.value)}
              maxLength={80}
            />
            {fileRepository && (
              <>
                <label htmlFor="repository-file-path">Repository path</label>
                <input
                  id="repository-file-path"
                  value={newRepositoryPath}
                  onChange={(event) => {
                    setFilePath(event.target.value);
                    setDialogError("");
                  }}
                  required
                />
                {pathCollision && (
                  <p role="alert">
                    A file already exists at {newRepositoryPath}. Choose another
                    path; no file will be overwritten.
                  </p>
                )}
              </>
            )}
            {dialogError && <p role="alert">{dialogError}</p>}
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setDialogMode(null)}
              >
                Cancel
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={!!pathCollision}
              >
                <Check size={15} />
                {dialogMode === "new"
                  ? "Create"
                  : dialogMode === "import"
                    ? "Import"
                    : "Save name"}
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
            <h2 id="delete-title">
              {documentRepository(activeDocument)
                ? "Remove working copy?"
                : "Delete this document?"}
            </h2>
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
                {documentRepository(activeDocument)
                  ? "Remove working copy"
                  : "Delete"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
