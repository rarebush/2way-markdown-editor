import { useEffect, useRef, useState } from "react";
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
import type { EditOrigin } from "./markdownSync";
import { createDocumentSaveScheduler } from "./documentSaveScheduler";
import {
  createDocument,
  documentRepository,
  deleteDocument,
  listDocuments,
  saveDocument,
  type GitHubOrigin,
  type RepositoryWorkspace,
  type WorkspaceDocument,
} from "./documents";
import "./App.css";

type ViewMode = "split" | "source" | "rendered";
type DialogMode = "new" | "import" | "rename" | null;
const emptyDocument: WorkspaceDocument = {
  id: "",
  name: "",
  content: "",
  updatedAt: 0,
};

function inWorkspace(
  document: WorkspaceDocument,
  space: "local" | "repository",
  repository: RepositoryWorkspace | null,
) {
  const owner = documentRepository(document);
  return space === "local"
    ? !owner
    : !!owner &&
        !!repository &&
        owner.repositoryId === repository.repositoryId &&
        owner.branch === repository.branch;
}

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
  const [space, setSpace] = useState<"local" | "repository">("local");
  const [selectedRepository, setSelectedRepository] =
    useState<RepositoryWorkspace | null>(null);
  const [lastEdit, setLastEdit] = useState<{
    documentId: string;
    content: string;
    origin: EditOrigin;
  } | null>(null);
  const [saveScheduler] = useState(() =>
    createDocumentSaveScheduler(saveDocument, 350),
  );
  const activeIdRef = useRef(activeId);
  const mountedRef = useRef(false);
  const [view, setView] = useState<ViewMode>("split");
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
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

  const activeDocument = documents.find((document) => document.id === activeId);
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
  const documentsRef = useRef(documents);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  function selectDocument(id: string) {
    const document = documentsRef.current.find((item) => item.id === id);
    if (!document) return;
    const repository = documentRepository(document);
    setSpace(repository ? "repository" : "local");
    if (repository) setSelectedRepository(repository);
    setActiveId(id);
  }

  function selectWorkspace(
    next: "local" | "repository",
    repository = selectedRepository,
  ) {
    setSpace(next);
    setSelectedRepository(repository);
    const current = documentsRef.current.find(
      (item) => item.id === activeId && inWorkspace(item, next, repository),
    );
    const first =
      current ??
      documentsRef.current.find((item) => inWorkspace(item, next, repository));
    setActiveId(first?.id ?? "");
  }

  async function updateGitHubDocument(
    id: string,
    update: (current: WorkspaceDocument) => WorkspaceDocument,
  ) {
    const current = documentsRef.current.find((item) => item.id === id);
    if (!current) throw new Error("The local draft was removed.");
    const updated = update(current);
    const next = documentsRef.current.map((item) =>
      item.id === id ? updated : item,
    );
    documentsRef.current = next;
    setDocuments(next);
    setSaveState("saving");
    saveScheduler.schedule(updated);
    try {
      await saveScheduler.flushAll();
      if (documentRepository(updated) && !documentRepository(current))
        selectDocument(updated.id);
    } catch (error) {
      const retained = documentsRef.current.map((item) =>
        item.id === id
          ? {
              ...item,
              github: current.github,
              githubPending: current.githubPending,
              repository: current.repository,
              repositoryPath: current.repositoryPath,
            }
          : item,
      );
      documentsRef.current = retained;
      setDocuments(retained);
      setSaveState("error");
      throw error;
    }
  }

  async function openGitHubDocument(
    origin: GitHubOrigin,
    separateCopy = false,
  ) {
    const current = documentsRef.current;
    const existing =
      !separateCopy &&
      current.find(
        (item) =>
          item.github?.repositoryId === origin.repositoryId &&
          item.github.branch === origin.branch &&
          item.github.path === origin.path,
      );
    if (existing) {
      selectDocument(existing.id);
      return;
    }
    const baseName =
      origin.path
        .split("/")
        .pop()
        ?.replace(/\.(md|markdown|mdown|mkd)$/i, "") || "GitHub document";
    const imported = {
      ...createDocument(baseName, origin.baseContent),
      github: origin,
    };
    await saveDocument(imported);
    documentsRef.current = [imported, ...documentsRef.current];
    setDocuments(documentsRef.current);
    selectDocument(imported.id);
  }

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void saveScheduler.flushAll().catch(() => undefined);
    };
  }, [saveScheduler]);

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
        documentsRef.current = availableDocuments;
        const repository = documentRepository(availableDocuments[0]);
        setSpace(repository ? "repository" : "local");
        setSelectedRepository(repository ?? null);
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

    const documentId = activeDocument.id;
    saveScheduler.schedule(activeDocument, {
      onSaved: () => {
        if (mountedRef.current && activeIdRef.current === documentId) {
          setSaveState("saved");
        }
      },
      onError: () => {
        if (mountedRef.current && activeIdRef.current === documentId) {
          setSaveState("error");
        }
      },
    });
  }, [activeDocument, ready, saveScheduler]);

  function updateContent(content: string, origin: EditOrigin) {
    setLastEdit({ documentId: activeId, content, origin });
    setSaveState("saving");
    const next = documentsRef.current.map((document) =>
      document.id === activeId
        ? { ...document, content, updatedAt: Date.now() }
        : document,
    );
    documentsRef.current = next;
    setDocuments(next);
  }

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
      setSaveState("saving");
      const createdDocument = {
        ...createDocument(trimmedName, content),
        ...(fileRepository
          ? { repository: fileRepository, repositoryPath: newRepositoryPath }
          : {}),
      };
      await saveDocument(createdDocument);
      documentsRef.current = [createdDocument, ...documentsRef.current];
      setDocuments(documentsRef.current);
      selectDocument(createdDocument.id);
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
        await updateGitHubDocument(activeDocument.id, (current) => ({
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

  async function saveLocalCopy(source: WorkspaceDocument) {
    const copy = createDocument(`${source.name} copy`, source.content);
    await saveDocument(copy);
    documentsRef.current = [copy, ...documentsRef.current];
    setDocuments(documentsRef.current);
    selectDocument(copy.id);
  }

  async function removeDocumentById(id: string) {
    const removed = documentsRef.current.find((item) => item.id === id);
    if (!removed || removed.githubPending) return;
    setSaveState("saving");
    await saveScheduler.cancel(id);
    await deleteDocument(id);
    const remaining = documentsRef.current.filter(
      (document) => document.id !== id,
    );
    documentsRef.current = remaining;

    if (remaining.length || space === "repository") {
      setDocuments(remaining);
      setActiveId(
        remaining.find((item) => inWorkspace(item, space, selectedRepository))
          ?.id ?? "",
      );
    } else {
      const replacement = createDocument("Field notes", starterMarkdown);
      await saveDocument(replacement);
      documentsRef.current = [replacement];
      setDocuments([replacement]);
      setActiveId(replacement.id);
    }

    setShowDeleteConfirm(false);
    setSaveState("saved");
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
    const existingNames = new Set(
      documents
        .filter((document) => !documentRepository(document))
        .map((document) => document.name.toLocaleLowerCase()),
    );
    let uniqueName = baseName;
    let suffix = 2;
    while (existingNames.has(uniqueName.toLocaleLowerCase())) {
      uniqueName = `${baseName} (${suffix})`;
      suffix += 1;
    }

    const imported = createDocument(uniqueName, content);
    setSaveState("saving");
    await saveDocument(imported);
    documentsRef.current = [imported, ...documentsRef.current];
    setDocuments(documentsRef.current);
    selectDocument(imported.id);
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
            onUpdate={updateGitHubDocument}
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
                origin={
                  lastEdit?.documentId === activeDocument.id &&
                  lastEdit.content === activeDocument.content
                    ? lastEdit.origin
                    : undefined
                }
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
