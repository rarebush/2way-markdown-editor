import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createTwoFilesPatch } from "diff";
import {
  Check,
  ChevronRight,
  ArrowRightLeft,
  FileText,
  Folder,
  GitBranch,
  GitFork as Github,
  LogOut,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
  Plus,
  FileInput,
  Undo2,
} from "lucide-react";
import type {
  GitHubOrigin,
  RepositoryWorkspace,
  WorkspaceDocument,
} from "./documents";
import { documentRepository } from "./documents";
import {
  GitHubClient,
  GitHubError,
  parseRepository,
  type GitHubCommit,
  type GitHubRepository,
  type GitHubTarget,
  type GitHubTreeEntry,
} from "./githubClient";
import {
  buildGitHubCommit,
  checkGitHubCommit,
  finishGitHubCommit,
  prepareGitHubChange,
  repositoryFilename,
  type GitHubOperation,
  type GitHubReview,
} from "./githubSync";

type Props = {
  document: WorkspaceDocument;
  documents?: WorkspaceDocument[];
  localSaveState?: "saved" | "saving" | "error";
  workspace?: "local" | "repository";
  selectedRepository?: RepositoryWorkspace;
  onWorkspaceChange?: (workspace: "local" | "repository") => void;
  onRepositoryChange?: (repository: RepositoryWorkspace) => void;
  onSelect?: (id: string) => void;
  onNew?: (repository?: RepositoryWorkspace, paths?: string[]) => void;
  onImport?: (repository?: RepositoryWorkspace, paths?: string[]) => void;
  fileActionsTarget?: HTMLElement | null;
  onRemoveWorkingCopy?: () => void;
  onSaveLocalCopy?: (document: WorkspaceDocument) => Promise<void>;
  onDeleteWorkingCopy?: (id: string) => Promise<void>;
  onOpen: (origin: GitHubOrigin, separateCopy?: boolean) => Promise<void>;
  onUpdate: (
    id: string,
    update: (current: WorkspaceDocument) => WorkspaceDocument,
  ) => Promise<void>;
};
type RemoteReview = {
  documentId: string;
  localContent: string;
  origin: GitHubOrigin;
};

type Publication = "local-move" | "repository-draft";

type FileActionForm =
  | { kind: "idle" }
  | {
      kind: "destination";
      documentId: string;
      publication: Publication;
      directory: string;
      newDirectory: string;
      filename: string;
    }
  | { kind: "rename"; destination: string };

type FileAction =
  | FileActionForm
  | { kind: "confirm"; task: "delete" | "discard" }
  | {
      kind: "review";
      review: GitHubReview;
      message: string;
      returnTo: FileActionForm;
    }
  | { kind: "sync"; comparison: RemoteReview };

type FileNode = {
  path: string;
  children: Map<string, FileNode>;
  entry?: GitHubTreeEntry;
};

function RepositoryTree({
  files,
  activePath,
  disabled,
  onOpen,
}: {
  files: GitHubTreeEntry[];
  activePath?: string;
  disabled: boolean;
  onOpen: (path: string) => void;
}) {
  const root: FileNode = { path: "", children: new Map() };
  for (const entry of files) {
    let node = root;
    for (const name of entry.path.split("/")) {
      if (!node.children.has(name))
        node.children.set(name, {
          path: [node.path, name].filter(Boolean).join("/"),
          children: new Map(),
        });
      node = node.children.get(name)!;
    }
    node.entry = entry;
  }
  function renderNodes(node: FileNode): React.ReactNode {
    return (
      <ul className="repository-tree">
        {[...node.children]
          .sort(
            ([firstName, first], [secondName, second]) =>
              Number(!second.entry) - Number(!first.entry) ||
              firstName.localeCompare(secondName),
          )
          .map(([name, child]) => (
            <li key={child.path}>
              {child.entry ? (
                <button
                  className={`github-row ${activePath === child.path ? "is-selected" : ""}`}
                  type="button"
                  title={child.path}
                  aria-current={activePath === child.path ? "page" : undefined}
                  disabled={disabled}
                  onClick={() => onOpen(child.path)}
                >
                  <FileText size={14} />
                  <span>{name}</span>
                </button>
              ) : (
                <details open>
                  <summary>
                    <ChevronRight size={12} className="tree-chevron" />
                    <Folder size={14} />
                    <span>{name}</span>
                  </summary>
                  {renderNodes(child)}
                </details>
              )}
            </li>
          ))}
      </ul>
    );
  }
  return renderNodes(root);
}

export function GitHubWorkspace({
  document,
  documents = [document],
  localSaveState,
  workspace,
  selectedRepository,
  onWorkspaceChange,
  onRepositoryChange,
  onSelect,
  onNew,
  onImport,
  fileActionsTarget,
  onRemoveWorkingCopy,
  onSaveLocalCopy,
  onDeleteWorkingCopy,
  onOpen,
  onUpdate,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const workingRef = useRef(false);
  const [client, setClient] = useState<GitHubClient | null>(null);
  const [internalWorkspace, setInternalWorkspace] = useState<
    "local" | "repository"
  >(documentRepository(document) ? "repository" : "local");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPurpose, setDialogPurpose] = useState<"settings" | "file">(
    "settings",
  );
  const [identity, setIdentity] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [repositoryPage, setRepositoryPage] = useState(0);
  const [moreRepositories, setMoreRepositories] = useState(false);
  const [filter, setFilter] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchPage, setBranchPage] = useState(0);
  const [moreBranches, setMoreBranches] = useState(false);
  const [branch, setBranch] = useState("");
  const [snapshot, setSnapshot] = useState<GitHubCommit | null>(null);
  const [entries, setEntries] = useState<GitHubTreeEntry[]>([]);
  const [fileAction, setFileAction] = useState<FileAction>({ kind: "idle" });

  useEffect(
    () => () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  const target: GitHubTarget | null =
    repository && branch
      ? {
          repositoryId: repository.id,
          owner: repository.owner.login,
          repo: repository.name,
          branch,
        }
      : (selectedRepository ?? documentRepository(document) ?? null);
  const space = workspace ?? internalWorkspace;
  const repositoryActionHint =
    space !== "repository"
      ? null
      : !client
        ? "Connect GitHub to add or import files."
        : !target
          ? "Select a repository to add or import files."
          : null;
  const linked = document.github;
  const pending = document.githubPending;
  const destination =
    fileAction.kind === "rename" ? fileAction.destination : "";
  const moveDirectory =
    fileAction.kind === "destination" ? fileAction.directory : "";
  const newDirectory =
    fileAction.kind === "destination" ? fileAction.newDirectory : "";
  const moveFilename =
    fileAction.kind === "destination" ? fileAction.filename : "";
  const review = fileAction.kind === "review" ? fileAction.review : null;
  const message = fileAction.kind === "review" ? fileAction.message : "";
  const remoteReview =
    fileAction.kind === "sync" ? fileAction.comparison : null;
  const fileTask = fileAction.kind === "confirm" ? fileAction.task : null;
  const publicationForm =
    fileAction.kind === "review" ? fileAction.returnTo : fileAction;
  const publishingRepositoryDraft =
    publicationForm.kind === "destination" &&
    publicationForm.publication === "repository-draft";
  const moveDocument = documents.find(
    (item) =>
      fileAction.kind === "destination" &&
      item.id === fileAction.documentId &&
      !item.github,
  );
  const repositoryFiles: GitHubTreeEntry[] = [
    ...entries.filter((entry) => entry.type === "blob"),
    ...documents
      .filter((item) => {
        const owner = documentRepository(item);
        return (
          !item.github &&
          !!item.repositoryPath &&
          owner?.repositoryId === target?.repositoryId &&
          owner?.branch === target?.branch &&
          !entries.some((entry) => entry.path === item.repositoryPath)
        );
      })
      .map((item) => ({
        path: item.repositoryPath!,
        type: "blob" as const,
        mode: "100644",
        sha: item.id,
      })),
  ];
  const selectedDirectory =
    moveDirectory === "__new_directory__" ? newDirectory.trim() : moveDirectory;
  const movePath = [selectedDirectory, moveFilename].filter(Boolean).join("/");
  const moveCollision = entries.some((entry) => entry.path === movePath);
  const directories = new Set([""]);
  for (const entry of [...entries, ...repositoryFiles]) {
    if (entry.type === "tree") directories.add(entry.path);
    const parts = entry.path.split("/");
    parts.pop();
    while (parts.length) {
      directories.add(parts.join("/"));
      parts.pop();
    }
  }
  const otherCachedFiles = documents.filter((item) => {
    const repository = documentRepository(item);
    return (
      !!repository &&
      repository.repositoryId === target?.repositoryId &&
      repository.branch === target.branch &&
      !repositoryFiles.some(
        (entry) =>
          entry.path === (item.github?.path ?? item.repositoryPath) &&
          (!!item.github || entry.sha === item.id),
      )
    );
  });

  function changeWorkspace(next: "local" | "repository") {
    setInternalWorkspace(next);
    onWorkspaceChange?.(next);
  }

  function selectRepositoryWorkspace(repository: RepositoryWorkspace) {
    setInternalWorkspace("repository");
    if (onRepositoryChange) onRepositoryChange(repository);
    else onWorkspaceChange?.("repository");
  }

  function startLocalMove(item: WorkspaceDocument) {
    if (!client || !target || documentRepository(item) || item.githubPending)
      return;
    onSelect?.(item.id);
    setFileAction({
      kind: "destination",
      documentId: item.id,
      publication: "local-move",
      directory: "",
      newDirectory: "",
      filename: repositoryFilename(item.name),
    });
    show();
  }

  function startRepositoryCreation() {
    if (
      !client ||
      !target ||
      !document.repositoryPath ||
      document.github ||
      pending
    )
      return;
    const parts = document.repositoryPath.split("/");
    const filename = parts.pop()!;
    setFileAction({
      kind: "destination",
      documentId: document.id,
      publication: "repository-draft",
      directory: parts.join("/"),
      newDirectory: "",
      filename,
    });
    show();
  }

  function startRemoteRename() {
    if (!client || !linked || busy || pending) return;
    setFileAction({ kind: "rename", destination: linked.path });
    show();
  }

  function updateTreeAfterCommit(
    candidate: NonNullable<WorkspaceDocument["githubPending"]>,
    oldPath?: string,
  ) {
    setSnapshot(null);
    if (
      target?.repositoryId === candidate.origin.repositoryId &&
      target.branch === candidate.origin.branch
    ) {
      setEntries((current) => [
        ...current.filter(
          (entry) =>
            entry.path !== oldPath && entry.path !== candidate.origin.path,
        ),
        ...(candidate.operation === "delete"
          ? []
          : [
              {
                path: candidate.origin.path,
                type: "blob" as const,
                mode: candidate.origin.mode,
                sha: candidate.origin.blobSha,
              },
            ]),
      ]);
    }
  }

  function show(purpose: "settings" | "file" = "file") {
    setDialogPurpose(purpose);
    if (purpose === "settings") {
      setFileAction({ kind: "idle" });
    }
    setError("");
    setNotice("");
    setDialogOpen(true);
    dialogRef.current?.showModal();
  }

  function close() {
    if (workingRef.current) return;
    generationRef.current += 1;
    setToken("");
    setFileAction({ kind: "idle" });
    setDialogOpen(false);
    dialogRef.current?.close();
  }

  function startFileTask(task: "delete" | "discard") {
    show();
    setFileAction({ kind: "confirm", task });
  }

  async function discardChanges(latest: boolean) {
    if (!linked || pending) return;
    const content = document.content;
    await run(async () => {
      const origin =
        latest && client ? await client.open(linked, linked.path) : linked;
      await onUpdate(document.id, (current) => {
        if (current.githubPending || current.content !== content)
          throw new GitHubError(
            "The draft changed. Review it again before discarding changes.",
          );
        return {
          ...current,
          content: origin.baseContent,
          github: origin,
          updatedAt: Date.now(),
        };
      });
      setFileAction({ kind: "idle" });
      setDialogOpen(false);
      dialogRef.current?.close();
    });
  }

  async function run(action: (isCurrent: () => boolean) => Promise<void>) {
    if (workingRef.current) return;
    workingRef.current = true;
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action(isCurrent);
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof GitHubError
            ? failure.message
            : "The operation could not be completed. Your local draft is retained.",
        );
    } finally {
      workingRef.current = false;
      if (isCurrent()) {
        setBusy(false);
        setMutating(false);
      }
    }
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    const suppliedToken = token.trim();
    setToken("");
    if (!suppliedToken) return;
    await run(async (isCurrent) => {
      const controller = new AbortController();
      controllerRef.current?.abort();
      controllerRef.current = controller;
      const connected = new GitHubClient(suppliedToken, controller.signal);
      const user = await connected.identity();
      if (!isCurrent()) return;
      setIdentity(user.login);
      setClient(connected);
      const repos = await connected.repositories();
      if (!isCurrent()) return;
      setRepositories(repos);
      setRepositoryPage(1);
      setMoreRepositories(repos.length === 100);
    });
  }

  function disconnect() {
    if (workingRef.current) return;
    controllerRef.current?.abort();
    controllerRef.current = null;
    generationRef.current += 1;
    setClient(null);
    setIdentity("");
    setToken("");
    setRepositories([]);
    setRepository(null);
    setBranches([]);
    setBranch("");
    setEntries([]);
    setSnapshot(null);
    setFileAction({ kind: "idle" });
    setRepositoryPage(0);
    setMoreRepositories(false);
    setRepoInput("");
    setFilter("");
    setError("");
    setNotice("");
  }

  async function chooseRepository(input: string) {
    if (!client) return;
    await run(async (isCurrent) => {
      setRepository(null);
      setSnapshot(null);
      setEntries([]);
      const selected = await client.repository(parseRepository(input));
      const listedBranches = await client.branches({
        owner: selected.owner.login,
        repo: selected.name,
      });
      const selectedTarget = {
        repositoryId: selected.id,
        owner: selected.owner.login,
        repo: selected.name,
        branch: selected.default_branch,
      };
      const head = await client.head(selectedTarget);
      const files = await client.markdownFiles(
        selectedTarget,
        head.tree.sha,
        true,
      );
      if (!isCurrent()) return;
      setRepository(selected);
      setBranches([
        ...new Set([
          selected.default_branch,
          ...listedBranches.map((item) => item.name),
        ]),
      ]);
      setBranchPage(1);
      setMoreBranches(listedBranches.length === 100);
      setBranch(selected.default_branch);
      setSnapshot(head);
      setEntries(files);
      selectRepositoryWorkspace(selectedTarget);
      setDialogOpen(false);
      dialogRef.current?.close();
    });
  }

  async function browse(selectedBranch = branch) {
    if (!client || !target) return;
    await run(async (isCurrent) => {
      const selectedTarget = { ...target, branch: selectedBranch };
      const head = await client.head(selectedTarget);
      const files = await client.markdownFiles(
        selectedTarget,
        head.tree.sha,
        true,
      );
      if (!isCurrent()) return;
      setBranch(selectedBranch);
      setSnapshot(head);
      setEntries(files);
      selectRepositoryWorkspace(selectedTarget);
    });
  }

  async function openRepositoryFile(path: string) {
    if (!target) return;
    const cached = documents.find((item) => {
      const owner = documentRepository(item);
      return (
        owner?.repositoryId === target.repositoryId &&
        owner.branch === target.branch &&
        (item.github?.path ?? item.repositoryPath) === path &&
        (!!item.github || !entries.some((entry) => entry.path === path))
      );
    });
    if (cached && onSelect) {
      onSelect(cached.id);
      return;
    }
    if (!client) return;
    await run(async () => {
      await onOpen(await client.open(target, path, snapshot ?? undefined));
    });
  }

  async function prepare(operation: GitHubOperation) {
    if (!client) return;
    show();
    const selectedTarget = operation === "create" ? target : linked;
    if (!selectedTarget) {
      setError("Select a repository and branch first.");
      return;
    }
    await run(async (isCurrent) => {
      const source = operation === "create" ? moveDocument : document;
      if (!source || !source.id || (operation === "create" && !!source.github))
        throw new GitHubError("Select a local file to move.");
      const owner = documentRepository(source);
      if (
        operation === "create" &&
        owner &&
        (owner.repositoryId !== selectedTarget.repositoryId ||
          owner.branch !== selectedTarget.branch)
      ) {
        throw new GitHubError(
          "This draft belongs to a different repository or branch.",
        );
      }
      let prepared: GitHubReview;
      try {
        prepared = await prepareGitHubChange(
          client,
          source,
          operation,
          selectedTarget,
          operation === "create" ? movePath : destination,
        );
      } catch (failure) {
        if (
          operation !== "update" ||
          !(failure instanceof GitHubError) ||
          failure.status !== 409 ||
          !failure.message.startsWith("The remote file changed")
        )
          throw failure;
        const remote = await client.open(selectedTarget, source.github!.path);
        if (!isCurrent()) return;
        setFileAction({
          kind: "sync",
          comparison: {
            documentId: source.id,
            localContent: source.content,
            origin: remote,
          },
        });
        setNotice(
          "GitHub has a newer version. Choose which content to keep before committing.",
        );
        return;
      }
      if (!isCurrent()) return;
      setFileAction({
        kind: "review",
        review: prepared,
        message: `${operation === "move" ? "Move" : operation === "delete" ? "Delete" : operation === "create" ? "Create" : "Update"} ${prepared.origin.path}`,
        returnTo:
          fileAction.kind === "destination" || fileAction.kind === "rename"
            ? fileAction
            : { kind: "idle" },
      });
    });
  }

  async function commit(event: React.FormEvent) {
    event.preventDefault();
    if (!client || fileAction.kind !== "review") return;
    const { review, message, returnTo } = fileAction;
    await run(async () => {
      setMutating(true);
      const candidate = await buildGitHubCommit(client, review, message);
      await onUpdate(review.documentId, (current) => {
        if (current.githubPending)
          throw new GitHubError(
            "A previous commit is still awaiting confirmation.",
          );
        return { ...current, githubPending: candidate };
      });
      try {
        await client.publish(candidate.origin, candidate.candidateSha);
      } catch (failure) {
        setFileAction(returnTo);
        if (!(failure instanceof GitHubError) || failure.uncertain)
          throw failure;
        await onUpdate(review.documentId, (current) => ({
          ...current,
          githubPending: undefined,
        }));
        throw failure;
      }
      setFileAction({ kind: "idle" });
      await onUpdate(review.documentId, (current) =>
        finishGitHubCommit(current, candidate),
      );
      if (candidate.operation === "create") {
        changeWorkspace("repository");
      }
      updateTreeAfterCommit(candidate, review.oldPath);
      setNotice(
        `Committed to ${candidate.origin.owner}/${candidate.origin.repo} on ${candidate.origin.branch}.`,
      );
      if (candidate.operation === "delete" && onDeleteWorkingCopy) {
        await onDeleteWorkingCopy(review.documentId);
        setDialogOpen(false);
        dialogRef.current?.close();
      }
    });
  }

  async function recover() {
    if (!client || !pending) return;
    show();
    await run(async () => {
      const outcome = await checkGitHubCommit(client, pending);
      if (outcome === "unknown")
        throw new GitHubError(
          "The branch history changed and the outcome is still uncertain. Check the candidate commit on GitHub before making another write.",
        );
      await onUpdate(document.id, (current) =>
        outcome === "published"
          ? finishGitHubCommit(current, pending)
          : { ...current, githubPending: undefined },
      );
      if (outcome === "published") updateTreeAfterCommit(pending, linked?.path);
      if (
        outcome === "published" &&
        pending.operation === "delete" &&
        onDeleteWorkingCopy
      )
        await onDeleteWorkingCopy(document.id);
      if (outcome === "published" && pending.operation === "create") {
        changeWorkspace("repository");
      }
      setNotice(
        outcome === "published"
          ? "The commit was published. Its local link has been recovered."
          : "The commit was not published. Review the change again before retrying.",
      );
    });
  }

  async function refresh() {
    if (!client || !linked) return;
    show();
    setFileAction({ kind: "idle" });
    await run(async (isCurrent) => {
      const repositoryInfo = await client.repository(linked);
      if (repositoryInfo.id !== linked.repositoryId)
        throw new GitHubError(
          "The repository identity changed. Open the file again as a separate draft.",
        );
      const remote = await client.open(linked, linked.path);
      if (!isCurrent()) return;
      if (
        remote.baseContent === document.content &&
        remote.blobSha !== linked.blobSha
      ) {
        await onUpdate(document.id, (current) => {
          if (current.content !== document.content || current.githubPending)
            throw new GitHubError("The draft changed. Sync again.");
          return { ...current, github: remote, updatedAt: Date.now() };
        });
        if (!isCurrent()) return;
      }
      setFileAction({
        kind: "sync",
        comparison: {
          documentId: document.id,
          localContent: document.content,
          origin: remote,
        },
      });
    });
  }

  async function adoptRemote(replace: boolean) {
    if (!remoteReview) return;
    await run(async () => {
      let updated: WorkspaceDocument | undefined;
      await onUpdate(remoteReview.documentId, (current) => {
        if (
          current.content !== remoteReview.localContent ||
          current.githubPending
        )
          throw new GitHubError(
            "The draft changed. Compare again before replacing its content or base.",
          );
        updated = {
          ...current,
          content: replace ? remoteReview.origin.baseContent : current.content,
          github: remoteReview.origin,
          updatedAt: Date.now(),
        };
        return updated;
      });
      if (!replace && updated && client) {
        const prepared = await prepareGitHubChange(
          client,
          updated,
          "update",
          remoteReview.origin,
        );
        setFileAction({
          kind: "review",
          review: prepared,
          message: `Update ${prepared.origin.path}`,
          returnTo: { kind: "idle" },
        });
      } else {
        setFileAction({ kind: "idle" });
      }
      setNotice(
        replace
          ? "The draft now contains the checked GitHub version."
          : "Review the changes before committing to GitHub.",
      );
      if (replace) {
        setDialogOpen(false);
        dialogRef.current?.close();
      }
    });
  }

  const remoteMatchesLocal =
    remoteReview !== null &&
    remoteReview.origin.baseContent === remoteReview.localContent;
  const diff = review
    ? createTwoFilesPatch(
        review.oldPath || "/dev/null",
        review.operation === "delete" ? "/dev/null" : review.origin.path,
        review.before,
        review.after,
      )
    : remoteReview
      ? createTwoFilesPatch(
          "GitHub",
          "Local draft",
          remoteReview.origin.baseContent,
          remoteReview.localContent,
        )
      : "";
  const remoteState = pending
    ? "Commit outcome unconfirmed"
    : space === "repository" && linked
      ? document.content === linked.baseContent
        ? "Matches last GitHub check"
        : "Uncommitted changes"
      : space === "repository" &&
          document.repositoryPath &&
          documentRepository(document)
        ? "Uncommitted changes"
        : null;

  const localMoveAction =
    space === "local" && document.id && !documentRepository(document) ? (
      <button
        className="icon-button"
        type="button"
        aria-label={`Move ${document.name} to repository`}
        title="Move to repository"
        disabled={busy || !client || !target || !!pending}
        onClick={() => startLocalMove(document)}
      >
        <ArrowRightLeft size={16} />
      </button>
    ) : null;

  const fileActions = (
    <>
      {localMoveAction}
      {space === "repository" &&
        document.id &&
        !linked &&
        document.repositoryPath &&
        !pending && (
          <button
            className="icon-button"
            type="button"
            aria-label="Create on GitHub"
            title="Create on GitHub"
            disabled={busy || !client}
            onClick={startRepositoryCreation}
          >
            <Save size={16} />
          </button>
        )}
      {space === "repository" && linked && !pending && (
        <>
          <button
            className="icon-button"
            type="button"
            aria-label="Sync with GitHub"
            title="Sync with GitHub"
            disabled={busy || !client}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Commit changes"
            title="Commit changes"
            disabled={
              busy || !client || document.content === linked.baseContent
            }
            onClick={() => void prepare("update")}
          >
            <Save size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Rename on GitHub"
            title="Rename or move on GitHub"
            disabled={busy || !client}
            onClick={startRemoteRename}
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button danger-action"
            type="button"
            aria-label="Delete file"
            title="Delete file"
            disabled={busy}
            onClick={() => startFileTask("delete")}
          >
            <Trash2 size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Discard changes"
            title="Discard changes"
            disabled={busy}
            onClick={() => startFileTask("discard")}
          >
            <Undo2 size={16} />
          </button>
        </>
      )}
      {pending && (
        <button
          className="icon-button"
          type="button"
          aria-label="Check outcome"
          title="Check commit outcome"
          disabled={busy || !client}
          onClick={() => void recover()}
        >
          <RefreshCw size={16} />
        </button>
      )}
    </>
  );

  return (
    <aside className="github-workspace" aria-label="GitHub workspace">
      {fileActionsTarget
        ? createPortal(fileActions, fileActionsTarget)
        : fileActions}
      <div className="space-switcher" role="group" aria-label="Workspace">
        <button
          type="button"
          aria-pressed={space === "local"}
          disabled={busy}
          onClick={() => changeWorkspace("local")}
        >
          <Folder size={14} />
          Local
        </button>
        <button
          type="button"
          aria-pressed={space === "repository"}
          disabled={busy}
          onClick={() => changeWorkspace("repository")}
        >
          <Github size={14} />
          Repository
        </button>
      </div>
      <div
        className="rail-file-actions"
        role="group"
        aria-label="Workspace file actions"
      >
        <button
          className="icon-button"
          type="button"
          aria-label="Add file"
          title="Add file"
          disabled={
            busy || !onNew || (space === "repository" && (!client || !target))
          }
          onClick={() =>
            space === "repository" && (!client || !target)
              ? undefined
              : onNew?.(
                  space === "repository" ? (target ?? undefined) : undefined,
                  entries.map((entry) => entry.path),
                )
          }
        >
          <Plus size={17} />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Import Markdown"
          title="Import Markdown"
          disabled={
            busy ||
            !onImport ||
            (space === "repository" && (!client || !target))
          }
          onClick={() =>
            space === "repository" && (!client || !target)
              ? undefined
              : onImport?.(
                  space === "repository" ? (target ?? undefined) : undefined,
                  entries.map((entry) => entry.path),
                )
          }
        >
          <FileInput size={17} />
        </button>
      </div>
      {repositoryActionHint && (
        <p className="rail-action-hint">{repositoryActionHint}</p>
      )}
      <div className="github-bar">
        {space === "repository" && (
          <button
            className="secondary-action"
            type="button"
            onClick={() => show("settings")}
          >
            <Github size={16} />
            {client ? "GitHub settings" : "Connect GitHub"}
          </button>
        )}
        {remoteState && (
          <span className="github-state" role="status">
            {remoteState}
          </span>
        )}
        {linked && (
          <span
            className="github-location"
            title={`${linked.owner}/${linked.repo} · ${linked.branch} · ${linked.path}`}
          >
            <GitBranch size={14} />
            <span className="github-location-path">{linked.path}</span>
          </span>
        )}
      </div>

      {localSaveState && (
        <div
          className={`save-indicator save-indicator--${localSaveState}`}
          aria-live="polite"
        >
          {localSaveState === "saved" ? (
            <Check size={14} />
          ) : localSaveState === "saving" ? (
            <Save size={14} />
          ) : (
            <X size={14} />
          )}
          <span>
            {localSaveState === "saved"
              ? "Saved locally"
              : localSaveState === "saving"
                ? "Saving"
                : "Not saved"}
          </span>
        </div>
      )}

      <div className="repository-controls" hidden={space !== "repository"}>
        <div className="repository-heading">
          <h2>
            {repository?.full_name ??
              (target ? `${target.owner}/${target.repo}` : "Repository")}
          </h2>
          {client && target && (
            <button
              className="icon-button"
              type="button"
              disabled={busy}
              aria-label="Refresh repository listing"
              title="Refresh repository listing"
              onClick={() => void browse()}
            >
              <RefreshCw size={15} />
            </button>
          )}
        </div>
        {repository && (
          <>
            <label className="visually-hidden" htmlFor="github-tree-branch">
              Repository branch
            </label>
            <select
              id="github-tree-branch"
              value={branch}
              disabled={busy}
              onChange={(event) => void browse(event.target.value)}
            >
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {moreBranches && (
              <button
                className="secondary-action"
                disabled={busy}
                onClick={() =>
                  void run(async (isCurrent) => {
                    if (!client) return;
                    const listed = await client.branches(
                      {
                        owner: repository.owner.login,
                        repo: repository.name,
                      },
                      branchPage + 1,
                    );
                    if (!isCurrent()) return;
                    setBranches((current) => [
                      ...new Set([
                        ...current,
                        ...listed.map((item) => item.name),
                      ]),
                    ]);
                    setBranchPage(branchPage + 1);
                    setMoreBranches(listed.length === 100);
                  })
                }
              >
                Load branches
              </button>
            )}
          </>
        )}
      </div>
      <nav className="workspace-file-navigation" aria-label="Workspace files">
        <section
          className="repository-navigation"
          aria-label="Repository files"
          hidden={space !== "repository"}
        >
          {target && (
            <>
              <RepositoryTree
                files={repositoryFiles}
                activePath={
                  documentRepository(document)?.repositoryId ===
                    target.repositoryId &&
                  documentRepository(document)?.branch === target.branch
                    ? (linked?.path ?? document.repositoryPath)
                    : undefined
                }
                disabled={busy}
                onOpen={(path) => void openRepositoryFile(path)}
              />
              {!repositoryFiles.length && !busy && (
                <p className="github-target">No Markdown files</p>
              )}
            </>
          )}
        </section>
        <section
          className="local-navigation"
          aria-label="Local drafts"
          hidden={space !== "local"}
        >
          <h2>Local files</h2>
          <ul className="repository-tree">
            {documents
              .filter((item) => !!item.id && !documentRepository(item))
              .map((item) => (
                <li key={item.id}>
                  <div className="local-file-row">
                    <button
                      className={`github-row ${item.id === document.id ? "is-selected" : ""}`}
                      type="button"
                      aria-current={
                        item.id === document.id ? "page" : undefined
                      }
                      disabled={busy || !onSelect}
                      onClick={() => onSelect?.(item.id)}
                    >
                      <FileText size={14} />
                      <span>{item.name}</span>
                    </button>
                  </div>
                </li>
              ))}
          </ul>
          {!documents.some((item) => item.id && !documentRepository(item)) && (
            <p className="github-target">No local files</p>
          )}
        </section>
        {!!otherCachedFiles.length && (
          <section
            className="local-navigation"
            aria-label="Repository working copies"
            hidden={space !== "repository"}
          >
            <h2>Working copies</h2>
            <ul className="repository-tree">
              {otherCachedFiles.map((item) => (
                <li key={item.id}>
                  <button
                    className={`github-row ${item.id === document.id ? "is-selected" : ""}`}
                    type="button"
                    title={
                      item.github?.path ?? item.repositoryPath ?? item.name
                    }
                    aria-current={item.id === document.id ? "page" : undefined}
                    disabled={busy || !onSelect}
                    onClick={() => onSelect?.(item.id)}
                  >
                    <FileText size={14} />
                    <span>
                      {item.github?.path ?? item.repositoryPath ?? item.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>
      {!dialogOpen && (
        <>
          {busy && (
            <p role="status" className="github-feedback">
              Opening...
            </p>
          )}
          {error && (
            <p role="alert" className="github-feedback github-feedback--error">
              {error}
            </p>
          )}
        </>
      )}

      <dialog
        ref={dialogRef}
        className="github-dialog"
        aria-labelledby="github-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          setToken("");
          setDialogOpen(false);
        }}
      >
        <div className="github-dialog-heading">
          <h2 id="github-title">
            <Github size={20} />
            {dialogPurpose === "settings"
              ? "GitHub settings"
              : "GitHub file actions"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close GitHub"
            title="Close GitHub"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {!client && !fileTask ? (
          <form
            className="github-connect"
            onSubmit={(event) => void connect(event)}
          >
            <label htmlFor="github-token">Personal access token</label>
            <input
              id="github-token"
              type="password"
              autoComplete="off"
              autoFocus
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              disabled={busy}
            />
            <a
              href="https://github.com/settings/personal-access-tokens/new?name=Draft&contents=write&expires_in=30"
              target="_blank"
              rel="noreferrer"
            >
              Create a fine-grained token
            </a>
            <button className="primary-action" disabled={busy} type="submit">
              <Github size={16} />
              Connect
            </button>
          </form>
        ) : (
          <>
            {dialogPurpose === "settings" && (
              <div className="github-connection">
                <span>{identity}</span>
                <button
                  className="secondary-action"
                  disabled={busy}
                  onClick={disconnect}
                >
                  <LogOut size={14} />
                  Disconnect
                </button>
              </div>
            )}
            {dialogPurpose === "file" && pending && (
              <div className="github-recovery">
                <a
                  href={`https://github.com/${encodeURIComponent(pending.origin.owner)}/${encodeURIComponent(pending.origin.repo)}/commit/${encodeURIComponent(pending.candidateSha)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View candidate commit
                </a>
              </div>
            )}
            {fileTask ? (
              <section className="github-review">
                <h3>
                  {fileTask === "delete" ? "Delete file" : "Discard changes"}
                </h3>
                <p className="github-target">{linked?.path}</p>
                <p className="github-target">
                  {fileTask === "delete"
                    ? "Removing a working copy leaves GitHub unchanged. Remote deletion also removes this working copy after the commit succeeds."
                    : "This discards your uncommitted edits. Choose the last checked version or the latest version from GitHub."}
                </p>
                <div className="github-choice-actions">
                  <button
                    className="secondary-action"
                    disabled={busy}
                    onClick={close}
                  >
                    Cancel
                  </button>
                  {fileTask === "delete" ? (
                    <>
                      <button
                        className="secondary-action"
                        disabled={busy || !onRemoveWorkingCopy}
                        onClick={() => {
                          close();
                          onRemoveWorkingCopy?.();
                        }}
                      >
                        <X size={15} />
                        Remove working copy
                      </button>
                      <button
                        className="delete-button"
                        disabled={busy || !client}
                        onClick={() => void prepare("delete")}
                      >
                        <Trash2 size={15} />
                        Review deletion from GitHub
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="delete-button"
                        disabled={busy}
                        onClick={() => void discardChanges(false)}
                      >
                        <Undo2 size={15} />
                        Restore last checked version
                      </button>
                      <button
                        className="delete-button"
                        disabled={busy || !client}
                        onClick={() => void discardChanges(true)}
                      >
                        <RefreshCw size={15} />
                        Discard edits and sync latest
                      </button>
                    </>
                  )}
                </div>
              </section>
            ) : review ? (
              <form
                className="github-review"
                onSubmit={(event) => void commit(event)}
              >
                <h3>
                  {review.operation === "delete"
                    ? "Delete from GitHub and this browser"
                    : review.operation === "create"
                      ? publishingRepositoryDraft
                        ? "Create file on GitHub"
                        : "Move to repository"
                      : review.operation === "move"
                        ? "Move on GitHub"
                        : "Commit Markdown"}
                </h3>
                <p className="github-target">
                  {review.origin.owner}/{review.origin.repo} /{" "}
                  {review.origin.branch}
                  <br />
                  {review.oldPath && review.oldPath !== review.origin.path
                    ? `${review.oldPath} -> `
                    : ""}
                  {review.origin.path}
                </p>
                {review.operation === "move" && (
                  <p className="github-target">
                    Remote content only. Local edits remain uncommitted.
                  </p>
                )}
                {review.operation === "delete" && (
                  <p className="github-target">
                    This deletes the GitHub file and its working copy in this
                    browser, including uncommitted edits.
                  </p>
                )}
                <pre
                  className="github-diff"
                  tabIndex={0}
                  aria-label="Markdown changes"
                >
                  {diff}
                </pre>
                <label htmlFor="github-message">Commit message</label>
                <input
                  id="github-message"
                  value={message}
                  onChange={(event) => {
                    const message = event.target.value;
                    setFileAction((current) =>
                      current.kind === "review"
                        ? { ...current, message }
                        : current,
                    );
                  }}
                  maxLength={500}
                  required
                  disabled={busy}
                />
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy}
                    onClick={close}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={
                      review.operation === "delete"
                        ? "delete-button"
                        : "primary-action"
                    }
                    disabled={busy || !message.trim()}
                  >
                    {review.operation === "delete" ? (
                      <Trash2 size={15} />
                    ) : (
                      <Check size={15} />
                    )}
                    {review.operation === "delete"
                      ? "Confirm remote deletion"
                      : review.operation === "create"
                        ? publishingRepositoryDraft
                          ? "Create on GitHub"
                          : "Move to repository"
                        : "Commit to GitHub"}
                  </button>
                </div>
              </form>
            ) : remoteReview ? (
              <section className="github-review">
                <h3>Sync with GitHub</h3>
                <p className="github-target">
                  {remoteReview.origin.owner}/{remoteReview.origin.repo} /{" "}
                  {remoteReview.origin.branch} / {remoteReview.origin.path}
                </p>
                {remoteMatchesLocal ? (
                  <p role="status">No changes. This draft matches GitHub.</p>
                ) : (
                  <>
                    <p className="github-target">
                      Committing the draft replaces GitHub's file content.
                      Remote edits are not merged. Using GitHub's version
                      discards your draft edits.
                    </p>
                    <pre
                      className="github-diff"
                      tabIndex={0}
                      aria-label="GitHub versus local Markdown"
                    >
                      {diff}
                    </pre>
                  </>
                )}
                <div className="github-choice-actions">
                  <button
                    className="secondary-action"
                    disabled={busy}
                    onClick={close}
                  >
                    {remoteMatchesLocal ? "Close" : "Ignore GitHub version"}
                  </button>
                  <button
                    className="secondary-action"
                    disabled={busy || !onSaveLocalCopy}
                    onClick={() =>
                      void run(async () => {
                        if (onSaveLocalCopy) {
                          await onSaveLocalCopy({
                            ...document,
                            content: remoteReview.localContent,
                          });
                          dialogRef.current?.close();
                          setDialogOpen(false);
                          setFileAction({ kind: "idle" });
                        }
                      })
                    }
                  >
                    <FileText size={15} />
                    Save draft as Local copy
                  </button>
                  {!remoteMatchesLocal && (
                    <>
                      <button
                        className="secondary-action"
                        disabled={busy || !!pending}
                        onClick={() => void adoptRemote(false)}
                      >
                        Review and commit draft
                      </button>
                      <button
                        className="delete-button"
                        disabled={busy || !!pending}
                        onClick={() => void adoptRemote(true)}
                      >
                        <RefreshCw size={15} />
                        Discard draft and use GitHub version
                      </button>
                    </>
                  )}
                </div>
              </section>
            ) : fileAction.kind === "rename" && linked ? (
              <form
                className="github-review"
                onSubmit={(event) => {
                  event.preventDefault();
                  void prepare("move");
                }}
              >
                <h3>Rename or move on GitHub</h3>
                <p className="github-target">
                  {linked.owner}/{linked.repo} / {linked.branch} / {linked.path}
                </p>
                <label htmlFor="github-move-path">New remote path</label>
                <input
                  id="github-move-path"
                  value={destination}
                  onChange={(event) => {
                    const destination = event.target.value;
                    setFileAction((current) =>
                      current.kind === "rename"
                        ? { ...current, destination }
                        : current,
                    );
                  }}
                  required
                  disabled={busy}
                />
                <div className="dialog-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={busy}
                    onClick={close}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-action"
                    type="submit"
                    disabled={busy || destination === linked.path}
                  >
                    <Pencil size={15} />
                    Review move
                  </button>
                </div>
              </form>
            ) : moveDocument ? (
              <form
                className="github-local-move"
                onSubmit={(event) => {
                  event.preventDefault();
                  void prepare("create");
                }}
              >
                <h3>
                  {publishingRepositoryDraft
                    ? "Create file on GitHub"
                    : "Move to repository"}
                </h3>
                <p className="github-target">
                  {moveDocument.name} / {target?.owner}/{target?.repo} /{" "}
                  {target?.branch}
                </p>
                <label htmlFor="github-move-directory">
                  Destination directory
                </label>
                <select
                  id="github-move-directory"
                  value={moveDirectory}
                  disabled={busy}
                  onChange={(event) => {
                    const directory = event.target.value;
                    setFileAction((current) =>
                      current.kind === "destination"
                        ? { ...current, directory }
                        : current,
                    );
                  }}
                >
                  {[...directories].sort().map((directory) => (
                    <option key={directory} value={directory}>
                      {directory || "/ (root)"}
                    </option>
                  ))}
                  <option value="__new_directory__">New directory...</option>
                </select>
                {moveDirectory === "__new_directory__" && (
                  <>
                    <label htmlFor="github-new-directory">
                      New directory path
                    </label>
                    <input
                      id="github-new-directory"
                      value={newDirectory}
                      required
                      disabled={busy}
                      onChange={(event) => {
                        const newDirectory = event.target.value;
                        setFileAction((current) =>
                          current.kind === "destination"
                            ? { ...current, newDirectory }
                            : current,
                        );
                      }}
                    />
                  </>
                )}
                <label htmlFor="github-move-filename">
                  Repository filename
                </label>
                <input
                  id="github-move-filename"
                  value={moveFilename}
                  disabled={busy}
                  required
                  onChange={(event) => {
                    const filename = event.target.value;
                    setFileAction((current) =>
                      current.kind === "destination"
                        ? { ...current, filename }
                        : current,
                    );
                  }}
                />
                <p className="github-target" aria-label="Destination path">
                  {movePath}
                </p>
                {moveCollision && (
                  <p
                    className="github-feedback github-feedback--error"
                    role="alert"
                  >
                    A file already exists at {movePath}. Choose another
                    directory or filename; the existing file will not be
                    overwritten.
                  </p>
                )}
                <div className="dialog-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={busy}
                    onClick={() => setFileAction({ kind: "idle" })}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-action"
                    type="submit"
                    disabled={
                      busy ||
                      moveCollision ||
                      !moveFilename.trim() ||
                      (moveDirectory === "__new_directory__" &&
                        !newDirectory.trim()) ||
                      repository?.archived
                    }
                  >
                    <ArrowRightLeft size={15} />
                    {publishingRepositoryDraft
                      ? "Review creation"
                      : "Review move"}
                  </button>
                </div>
              </form>
            ) : client && dialogPurpose === "settings" ? (
              <div className="github-browser">
                <div className="github-repositories">
                  <label htmlFor="github-filter">Repositories</label>
                  <input
                    id="github-filter"
                    type="search"
                    placeholder="Filter loaded repositories"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    disabled={busy}
                  />
                  <div className="github-repository-list">
                    {repositories
                      .filter((repo) =>
                        repo.full_name
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((repo) => (
                        <button
                          key={repo.id}
                          className={`github-row ${repository?.id === repo.id ? "is-selected" : ""}`}
                          disabled={busy}
                          onClick={() => void chooseRepository(repo.full_name)}
                        >
                          <Github size={14} />
                          <span>{repo.full_name}</span>
                        </button>
                      ))}
                  </div>
                  {(moreRepositories || repositoryPage === 0) && (
                    <button
                      className="secondary-action"
                      disabled={busy}
                      onClick={() =>
                        void run(async (isCurrent) => {
                          const repos = await client.repositories(
                            repositoryPage + 1,
                          );
                          if (!isCurrent()) return;
                          setRepositories((current) => [
                            ...current,
                            ...repos.filter(
                              (repo) =>
                                !current.some((item) => item.id === repo.id),
                            ),
                          ]);
                          setRepositoryPage(repositoryPage + 1);
                          setMoreRepositories(repos.length === 100);
                        })
                      }
                    >
                      Load repositories
                    </button>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void chooseRepository(repoInput);
                    }}
                  >
                    <label htmlFor="github-repository">
                      Repository URL or owner/name
                    </label>
                    <input
                      id="github-repository"
                      value={repoInput}
                      onChange={(event) => setRepoInput(event.target.value)}
                      required
                      disabled={busy}
                    />
                    <button
                      className="secondary-action"
                      type="submit"
                      disabled={busy}
                    >
                      <Folder size={15} />
                      Open repository
                    </button>
                  </form>
                </div>
                <div className="github-files">
                  {repository ? (
                    <>
                      <h3>{repository.full_name}</h3>
                      <p className="github-target">
                        {branch} /{" "}
                        {
                          entries.filter((entry) => entry.type === "blob")
                            .length
                        }{" "}
                        Markdown files
                      </p>
                    </>
                  ) : (
                    <p className="github-target">No repository selected.</p>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
        {busy && (
          <p role="status" className="github-feedback">
            {mutating ? "Committing to GitHub..." : "Working..."}
          </p>
        )}
        {notice && (
          <p role="status" className="github-feedback">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="github-feedback github-feedback--error">
            {error}
          </p>
        )}
      </dialog>
    </aside>
  );
}
