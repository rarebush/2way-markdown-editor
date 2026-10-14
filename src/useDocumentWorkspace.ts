import { useEffect, useRef, useState } from "react";
import { createDocumentSaveScheduler } from "./documentSaveScheduler";
import {
  createDocument,
  deleteDocument,
  documentRepository,
  inWorkspace,
  listDocuments,
  saveDocument,
  type GitHubOrigin,
  type RepositoryWorkspace,
  type WorkspaceDocument,
} from "./documents";
import type { EditOrigin } from "./markdownSync";

export function useDocumentWorkspace(starterMarkdown: string) {
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const documentsRef = useRef(documents);
  const [activeId, setActiveId] = useState("");
  const activeIdRef = useRef(activeId);
  const [space, setSpace] = useState<"local" | "repository">("local");
  const [selectedRepository, setSelectedRepository] =
    useState<RepositoryWorkspace | null>(null);
  const [lastEdit, setLastEdit] = useState<{
    documentId: string;
    content: string;
    origin: EditOrigin;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [saveScheduler] = useState(() =>
    createDocumentSaveScheduler(saveDocument, 350),
  );
  const mountedRef = useRef(false);
  const activeDocument = documents.find((document) => document.id === activeId);

  function replaceDocuments(next: WorkspaceDocument[]) {
    documentsRef.current = next;
    setDocuments(next);
  }

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

  async function addDocument(document: WorkspaceDocument) {
    setSaveState("saving");
    try {
      await saveDocument(document);
    } catch (error) {
      setSaveState("error");
      throw error;
    }
    replaceDocuments([document, ...documentsRef.current]);
    selectDocument(document.id);
  }

  async function createDraft(
    name: string,
    content: string,
    destination?: { repository: RepositoryWorkspace; path: string },
  ) {
    await addDocument({
      ...createDocument(name, content),
      ...(destination
        ? {
            repository: destination.repository,
            repositoryPath: destination.path,
          }
        : {}),
    });
  }

  async function updateDocument(
    id: string,
    update: (current: WorkspaceDocument) => WorkspaceDocument,
  ) {
    const current = documentsRef.current.find((item) => item.id === id);
    if (!current) throw new Error("The local draft was removed.");
    const updated = update(current);
    replaceDocuments(
      documentsRef.current.map((item) => (item.id === id ? updated : item)),
    );
    setSaveState("saving");
    saveScheduler.schedule(updated);
    try {
      await saveScheduler.flush(id);
      if (documentRepository(updated) && !documentRepository(current))
        selectDocument(updated.id);
    } catch (error) {
      replaceDocuments(
        documentsRef.current.map((item) =>
          item.id === id
            ? {
                ...item,
                github: current.github,
                githubPending: current.githubPending,
                repository: current.repository,
                repositoryPath: current.repositoryPath,
              }
            : item,
        ),
      );
      setSaveState("error");
      throw error;
    }
  }

  async function openGitHubDocument(
    origin: GitHubOrigin,
    separateCopy = false,
  ) {
    const existing =
      !separateCopy &&
      documentsRef.current.find(
        (item) =>
          !!item.github &&
          inWorkspace(item, "repository", origin) &&
          item.github.path === origin.path,
      );
    if (existing) {
      selectDocument(existing.id);
      return;
    }
    const name =
      origin.path
        .split("/")
        .pop()
        ?.replace(/\.(md|markdown|mdown|mkd)$/i, "") || "GitHub document";
    await addDocument({
      ...createDocument(name, origin.baseContent),
      github: origin,
    });
  }

  async function saveLocalCopy(source: WorkspaceDocument) {
    await createDraft(`${source.name} copy`, source.content);
  }

  async function importLocalDocument(name: string, content: string) {
    const existingNames = new Set(
      documentsRef.current
        .filter((document) => !documentRepository(document))
        .map((document) => document.name.toLocaleLowerCase()),
    );
    let uniqueName = name;
    let suffix = 2;
    while (existingNames.has(uniqueName.toLocaleLowerCase())) {
      uniqueName = `${name} (${suffix})`;
      suffix += 1;
    }
    await createDraft(uniqueName, content);
  }

  async function removeDocument(id: string) {
    const removed = documentsRef.current.find((item) => item.id === id);
    if (!removed || removed.githubPending) return;
    setSaveState("saving");
    try {
      await saveScheduler.cancel(id);
      await deleteDocument(id);
      const remaining = documentsRef.current.filter((item) => item.id !== id);
      if (remaining.length || space === "repository") {
        replaceDocuments(remaining);
        setActiveId(
          remaining.find((item) => inWorkspace(item, space, selectedRepository))
            ?.id ?? "",
        );
      } else {
        const replacement = createDocument("Field notes", starterMarkdown);
        await saveDocument(replacement);
        replaceDocuments([replacement]);
        setActiveId(replacement.id);
      }
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      throw error;
    }
  }

  function updateContent(content: string, origin: EditOrigin) {
    setLastEdit({ documentId: activeId, content, origin });
    setSaveState("saving");
    replaceDocuments(
      documentsRef.current.map((document) =>
        document.id === activeId
          ? { ...document, content, updatedAt: Date.now() }
          : document,
      ),
    );
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
        replaceDocuments(availableDocuments);
        const repository = documentRepository(availableDocuments[0]);
        setSpace(repository ? "repository" : "local");
        setSelectedRepository(repository ?? null);
        setActiveId(availableDocuments[0].id);
        setReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        const fallback = createDocument("Field notes", starterMarkdown);
        replaceDocuments([fallback]);
        setActiveId(fallback.id);
        setReady(true);
        setSaveState("error");
      });
    return () => {
      mounted = false;
    };
  }, [starterMarkdown]);

  useEffect(() => {
    if (!ready || !activeDocument) return;
    const documentId = activeDocument.id;
    saveScheduler.schedule(activeDocument, {
      onSaved: () => {
        if (mountedRef.current && activeIdRef.current === documentId)
          setSaveState("saved");
      },
      onError: () => {
        if (mountedRef.current && activeIdRef.current === documentId)
          setSaveState("error");
      },
    });
  }, [activeDocument, ready, saveScheduler]);

  return {
    documents,
    activeDocument,
    space,
    selectedRepository,
    ready,
    saveState,
    editOrigin:
      lastEdit?.documentId === activeDocument?.id &&
      lastEdit?.content === activeDocument?.content
        ? lastEdit?.origin
        : undefined,
    selectDocument,
    selectWorkspace,
    createDraft,
    updateDocument,
    openGitHubDocument,
    saveLocalCopy,
    importLocalDocument,
    removeDocument,
    updateContent,
  };
}
