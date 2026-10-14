// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubOrigin, WorkspaceDocument } from "./documents";
import { documentRepository } from "./documents";
import { GitHubClient, GitHubError } from "./githubClient";
import { GitHubWorkspace } from "./GitHubWorkspace";

const repository = {
  id: 1,
  full_name: "writer/notes",
  name: "notes",
  owner: { login: "writer" },
  default_branch: "main",
  archived: false,
};
const origin: GitHubOrigin = {
  repositoryId: 1,
  owner: "writer",
  repo: "notes",
  branch: "main",
  path: "notes.md",
  blobSha: "old-blob",
  commitSha: "head",
  baseContent: "Original\n",
  mode: "100644",
};
const local: WorkspaceDocument = {
  id: "draft",
  name: "Notes",
  content: "Edited\n",
  updatedAt: 1,
};

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
  vi.spyOn(GitHubClient.prototype, "identity").mockResolvedValue({
    login: "writer",
  });
  vi.spyOn(GitHubClient.prototype, "repositories").mockResolvedValue([
    repository,
  ]);
  vi.spyOn(GitHubClient.prototype, "repository").mockResolvedValue(repository);
  vi.spyOn(GitHubClient.prototype, "branches").mockResolvedValue([
    { name: "main" },
    { name: "docs/topic" },
  ]);
  vi.spyOn(GitHubClient.prototype, "head").mockResolvedValue({
    sha: "head",
    tree: { sha: "tree" },
  });
  vi.spyOn(GitHubClient.prototype, "folder").mockResolvedValue([
    { path: "notes.md", type: "blob", mode: "100644", sha: "old-blob" },
  ]);
  vi.spyOn(GitHubClient.prototype, "markdownFiles").mockResolvedValue([
    { path: "notes.md", type: "blob", mode: "100644", sha: "old-blob" },
    {
      path: "docs/deep/guide.md",
      type: "blob",
      mode: "100644",
      sha: "nested-blob",
    },
  ]);
  vi.spyOn(GitHubClient.prototype, "open").mockResolvedValue(origin);
  vi.spyOn(GitHubClient.prototype, "entry").mockResolvedValue(undefined);
  vi.spyOn(GitHubClient.prototype, "createBlob").mockResolvedValue({
    sha: "new-blob",
  });
  vi.spyOn(GitHubClient.prototype, "createTree").mockResolvedValue({
    sha: "new-tree",
  });
  vi.spyOn(GitHubClient.prototype, "createCommit").mockResolvedValue({
    sha: "candidate",
  });
  vi.spyOn(GitHubClient.prototype, "publish").mockResolvedValue({
    object: { sha: "candidate" },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function connect() {
  const user = userEvent.setup();
  const repositorySpace = screen.getByRole("button", { name: "Repository" });
  if (repositorySpace.getAttribute("aria-pressed") !== "true") {
    await user.click(repositorySpace);
  }
  await user.click(screen.getByRole("button", { name: "Connect GitHub" }));
  await user.type(
    screen.getByLabelText("Personal access token"),
    "test-only-pat",
  );
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByRole("button", { name: "Disconnect" });
  expect(screen.getByRole("button", { name: "GitHub settings" })).toBeDefined();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Disconnect" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  return user;
}

function renderLinkedDocument(
  props: Partial<Parameters<typeof GitHubWorkspace>[0]> = {},
) {
  let current = props.document ?? { ...local, github: origin };
  const onUpdate = vi.fn(
    async (
      _id: string,
      update: (document: WorkspaceDocument) => WorkspaceDocument,
    ) => {
      current = update(current);
      view.rerender(
        <GitHubWorkspace
          {...props}
          document={current}
          onOpen={vi.fn()}
          onUpdate={onUpdate}
        />,
      );
    },
  );
  const view = render(
    <GitHubWorkspace
      {...props}
      document={current}
      onOpen={vi.fn()}
      onUpdate={onUpdate}
    />,
  );
  return {
    get current() {
      return current;
    },
    onUpdate,
  };
}

describe("GitHub workspace", () => {
  it("updates the checked baseline when a newer remote revision already matches the draft", async () => {
    const remote = { ...origin, blobSha: "latest", baseContent: local.content };
    vi.mocked(GitHubClient.prototype.open).mockResolvedValue(remote);
    const state = renderLinkedDocument();
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Sync with GitHub" }));
    await screen.findByText("No changes. This draft matches GitHub.");
    expect(state.current.github).toEqual(remote);
    expect(state.current.content).toBe(local.content);
    expect(
      screen
        .getByRole("button", { name: "Commit changes" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
  });

  it("uses the checked GitHub version without publishing and closes the sync dialog", async () => {
    const remote = { ...origin, blobSha: "latest", baseContent: "Latest\n" };
    vi.mocked(GitHubClient.prototype.open).mockResolvedValue(remote);
    const state = renderLinkedDocument();
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Sync with GitHub" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Discard draft and use GitHub version",
      }),
    );
    await waitFor(() => expect(state.current.content).toBe(remote.baseContent));
    expect(state.current.github).toEqual(remote);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
  });

  it("removes the working copy when recovery confirms an uncertain remote deletion", async () => {
    const onDeleteWorkingCopy = vi.fn().mockResolvedValue(undefined);
    const state = renderLinkedDocument({
      document: {
        ...local,
        github: origin,
        githubPending: {
          operation: "delete",
          candidateSha: "head",
          previousHead: "previous",
          origin,
        },
      },
      onDeleteWorkingCopy,
    });
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Check outcome" }));
    await waitFor(() =>
      expect(onDeleteWorkingCopy).toHaveBeenCalledWith(local.id),
    );
    expect(state.current.githubPending).toBeUndefined();
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "discards edits using the latest remote version: %s",
    async (latest) => {
      const remote = { ...origin, blobSha: "latest", baseContent: "Latest\n" };
      vi.mocked(GitHubClient.prototype.open).mockResolvedValue(remote);
      const state = renderLinkedDocument();
      const user = latest ? await connect() : userEvent.setup();
      if (latest)
        await user.click(screen.getByRole("button", { name: "Close GitHub" }));
      await user.click(screen.getByRole("button", { name: "Discard changes" }));
      expect(state.onUpdate).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", {
          name: latest
            ? "Discard edits and sync latest"
            : "Restore last checked version",
        }),
      );
      await waitFor(() =>
        expect(state.current.content).toBe(
          latest ? remote.baseContent : origin.baseContent,
        ),
      );
      expect(state.current.github).toEqual(latest ? remote : origin);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
      if (!latest) expect(GitHubClient.prototype.open).not.toHaveBeenCalled();
    },
  );

  it("opens sync for a stale commit and ignoring it retains the previous baseline", async () => {
    const remote = { ...origin, blobSha: "latest", baseContent: "Latest\n" };
    vi.mocked(GitHubClient.prototype.open).mockResolvedValue(remote);
    const state = renderLinkedDocument();
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    await screen.findByRole("heading", { name: "Sync with GitHub" });
    expect(state.onUpdate).not.toHaveBeenCalled();
    expect(GitHubClient.prototype.createCommit).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Ignore GitHub version" }),
    );
    expect(state.current.github).toEqual(origin);
    expect(state.current.content).toBe(local.content);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reviews an explicit draft overwrite against the latest version before publishing", async () => {
    const remote = { ...origin, blobSha: "latest", baseContent: "Latest\n" };
    vi.mocked(GitHubClient.prototype.open).mockResolvedValue(remote);
    const state = renderLinkedDocument();
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    await screen.findByRole("heading", { name: "Sync with GitHub" });
    await user.click(
      screen.getByRole("button", { name: "Review and commit draft" }),
    );
    const diff = await screen.findByLabelText("Markdown changes");
    expect(diff.textContent).toContain("-Latest");
    expect(diff.textContent).toContain("+Edited");
    expect(state.current.content).toBe(local.content);
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Commit to GitHub" }));
    await waitFor(() =>
      expect(GitHubClient.prototype.publish).toHaveBeenCalledTimes(1),
    );
  });

  it.each([false, true])(
    "removes the working copy only after successful remote deletion: %s",
    async (reject) => {
      const onDeleteWorkingCopy = vi.fn().mockResolvedValue(undefined);
      const state = renderLinkedDocument({ onDeleteWorkingCopy });
      if (reject)
        vi.mocked(GitHubClient.prototype.publish).mockRejectedValueOnce(
          new GitHubError("Rejected", 403),
        );
      const user = await connect();
      await user.click(screen.getByRole("button", { name: "Close GitHub" }));
      await user.click(screen.getByRole("button", { name: "Delete file" }));
      await user.click(
        screen.getByRole("button", { name: "Review deletion from GitHub" }),
      );
      await screen.findByLabelText("Markdown changes");
      expect(onDeleteWorkingCopy).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", { name: "Confirm remote deletion" }),
      );
      if (reject) {
        await screen.findByRole("alert");
        expect(onDeleteWorkingCopy).not.toHaveBeenCalled();
        expect(state.current.github).toEqual(origin);
      } else {
        await waitFor(() =>
          expect(onDeleteWorkingCopy).toHaveBeenCalledWith(local.id),
        );
        expect(state.current.githubPending).toBeUndefined();
        expect(screen.queryByRole("dialog")).toBeNull();
      }
    },
  );

  it.each([true, false])(
    "shows the comparison result when Markdown matches GitHub: %s",
    async (matches) => {
      const onOpen = vi.fn();
      const onUpdate = vi.fn();
      render(
        <GitHubWorkspace
          document={{
            ...local,
            content: matches ? origin.baseContent : local.content,
            github: origin,
          }}
          onOpen={onOpen}
          onUpdate={onUpdate}
        />,
      );
      const user = await connect();
      await user.click(screen.getByRole("button", { name: "Close GitHub" }));
      await user.click(
        screen.getByRole("button", { name: "Sync with GitHub" }),
      );
      await screen.findByRole("heading", { name: "Sync with GitHub" });
      const dialog = screen.getByRole("dialog", {
        name: "GitHub file actions",
      });
      if (matches) {
        expect(
          within(dialog).getByText("No changes. This draft matches GitHub."),
        ).toBeDefined();
        expect(
          within(dialog).queryByLabelText("GitHub versus local Markdown"),
        ).toBeNull();
        for (const name of [
          "Review and commit draft",
          "Discard draft and use GitHub version",
        ]) {
          expect(within(dialog).queryByRole("button", { name })).toBeNull();
        }
      } else {
        const diff = within(dialog).getByLabelText(
          "GitHub versus local Markdown",
        );
        expect(diff.textContent).toContain("-Original");
        expect(diff.textContent).toContain("+Edited");
        expect(
          within(dialog).getByRole("button", {
            name: "Discard draft and use GitHub version",
          }),
        ).toBeDefined();
      }
      await user.click(
        within(dialog).getByRole("button", {
          name: matches ? "Close" : "Ignore GitHub version",
        }),
      );
      expect(dialog.hasAttribute("open")).toBe(false);
      expect(
        screen.queryByRole("dialog", { name: "GitHub file actions" }),
      ).toBeNull();
      expect(onOpen).not.toHaveBeenCalled();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
    },
  );

  it("keeps published-file actions beside the title and out of GitHub settings", async () => {
    render(
      <div
        className="title-actions"
        role="group"
        aria-label="Document actions"
      />,
    );
    const actions = screen.getByRole("group", { name: "Document actions" });
    const onRemoveWorkingCopy = vi.fn();
    render(
      <GitHubWorkspace
        document={{ ...local, github: origin }}
        fileActionsTarget={actions}
        onRemoveWorkingCopy={onRemoveWorkingCopy}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(
      within(actions)
        .getByRole("button", { name: "Rename on GitHub" })
        .hasAttribute("disabled"),
    ).toBe(true);
    const user = await connect();
    const settings = screen.getByRole("dialog", { name: "GitHub settings" });
    expect(within(settings).queryByText("Linked file")).toBeNull();
    for (const name of [
      "Sync with GitHub",
      "Commit changes",
      "Rename on GitHub",
      "Delete file",
      "Discard changes",
    ]) {
      expect(within(actions).getByRole("button", { name })).toBeDefined();
      expect(within(settings).queryByRole("button", { name })).toBeNull();
    }
    expect(
      screen
        .getByRole("complementary", { name: "GitHub workspace" })
        .querySelector('.github-bar button[aria-label="Sync with GitHub"]'),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(
      within(actions).getByRole("button", { name: "Delete file" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove working copy" }),
    );
    expect(onRemoveWorkingCopy).toHaveBeenCalledTimes(1);
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
  });

  it("renames a published path only after review and preserves uncommitted content", async () => {
    let current: WorkspaceDocument = { ...local, github: origin };
    const onOpen = vi.fn();
    const onUpdate = vi.fn(
      async (
        _id: string,
        update: (document: WorkspaceDocument) => WorkspaceDocument,
      ) => {
        current = update(current);
        view.rerender(
          <GitHubWorkspace
            document={current}
            onOpen={onOpen}
            onUpdate={onUpdate}
          />,
        );
      },
    );
    const view = render(
      <GitHubWorkspace
        document={current}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Rename on GitHub" }));
    expect(
      (screen.getByLabelText("New remote path") as HTMLInputElement).value,
    ).toBe(origin.path);
    await user.clear(screen.getByLabelText("New remote path"));
    await user.type(
      screen.getByLabelText("New remote path"),
      "docs/Renamed.md",
    );
    await user.click(screen.getByRole("button", { name: "Review move" }));
    await screen.findByLabelText("Markdown changes");
    const review = screen.getByRole("dialog", { name: "GitHub file actions" });
    expect(
      within(review).queryByRole("button", { name: "Disconnect" }),
    ).toBeNull();
    expect(within(review).queryByLabelText("Repositories")).toBeNull();
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
    await user.click(
      within(review).getByRole("button", { name: "Commit to GitHub" }),
    );
    await waitFor(() => expect(current.github?.path).toBe("docs/Renamed.md"));
    expect(current.name).toBe("Renamed");
    expect(current.content).toBe(local.content);
    expect(current.github?.baseContent).toBe(origin.baseContent);
    expect(GitHubClient.prototype.createBlob).not.toHaveBeenCalled();
    expect(GitHubClient.prototype.createTree).toHaveBeenCalledWith(
      expect.anything(),
      "tree",
      [
        {
          path: "docs/Renamed.md",
          mode: "100644",
          type: "blob",
          sha: "old-blob",
        },
        { path: "notes.md", mode: "100644", type: "blob", sha: null },
      ],
    );
  });

  it("clears cancelled actions before opening another file workflow or settings", async () => {
    const state = renderLinkedDocument();
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Rename on GitHub" }));
    await user.clear(screen.getByLabelText("New remote path"));
    await user.type(screen.getByLabelText("New remote path"), "cancelled.md");
    await user.click(screen.getByRole("button", { name: "Review move" }));
    await screen.findByLabelText("Markdown changes");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete file" }));
    expect(screen.getByRole("heading", { name: "Delete file" })).toBeDefined();
    expect(screen.queryByLabelText("New remote path")).toBeNull();
    expect(screen.queryByLabelText("Markdown changes")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(
      screen.getByRole("heading", { name: "Discard changes" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Review deletion from GitHub" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Sync with GitHub" }));
    await screen.findByLabelText("GitHub versus local Markdown");
    await user.click(
      screen.getByRole("button", { name: "Ignore GitHub version" }),
    );
    await user.click(screen.getByRole("button", { name: "GitHub settings" }));
    expect(screen.getByLabelText("Repositories")).toBeDefined();
    expect(screen.queryByLabelText("GitHub versus local Markdown")).toBeNull();
    expect(screen.queryByLabelText("New remote path")).toBeNull();
    expect(state.onUpdate).not.toHaveBeenCalled();
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
  });

  it("starts a fresh rename and commit message after cancelling a review", async () => {
    renderLinkedDocument();
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Rename on GitHub" }));
    await user.clear(screen.getByLabelText("New remote path"));
    await user.type(screen.getByLabelText("New remote path"), "cancelled.md");
    await user.click(screen.getByRole("button", { name: "Review move" }));
    await screen.findByLabelText("Commit message");
    await user.clear(screen.getByLabelText("Commit message"));
    await user.type(screen.getByLabelText("Commit message"), "Cancelled message");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Rename on GitHub" }));
    expect(
      (screen.getByLabelText("New remote path") as HTMLInputElement).value,
    ).toBe(origin.path);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    await screen.findByLabelText("Commit message");
    expect(
      (screen.getByLabelText("Commit message") as HTMLInputElement).value,
    ).toBe("Update notes.md");
    await user.clear(screen.getByLabelText("Commit message"));
    await user.type(screen.getByLabelText("Commit message"), "Save revised notes");
    await user.click(screen.getByRole("button", { name: "Commit to GitHub" }));
    await waitFor(() =>
      expect(GitHubClient.prototype.createCommit).toHaveBeenCalledWith(
        expect.objectContaining({ path: origin.path }),
        "head",
        "new-tree",
        "Save revised notes",
      ),
    );
  });

  it("requires confirmation to delete remotely and retains the repo working copy", async () => {
    let current: WorkspaceDocument = { ...local, github: origin };
    const onOpen = vi.fn();
    const onUpdate = vi.fn(
      async (
        _id: string,
        update: (document: WorkspaceDocument) => WorkspaceDocument,
      ) => {
        current = update(current);
        view.rerender(
          <GitHubWorkspace
            document={current}
            onOpen={onOpen}
            onUpdate={onUpdate}
          />,
        );
      },
    );
    const view = render(
      <GitHubWorkspace
        document={current}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Delete file" }));
    await user.click(
      screen.getByRole("button", { name: "Review deletion from GitHub" }),
    );
    await screen.findByLabelText("Markdown changes");
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirm remote deletion" }),
    );
    await waitFor(() => expect(current.github).toBeUndefined());
    expect(current.content).toBe(local.content);
    expect(documentRepository(current)?.repositoryId).toBe(1);
    expect(current.repositoryPath).toBe(origin.path);
  });

  it("renders only the active local file's move action next to the document title", async () => {
    render(
      <div
        className="title-actions"
        role="group"
        aria-label="Document actions"
      />,
    );
    const actions = screen.getByRole("group", { name: "Document actions" });
    const another = { ...local, id: "another", name: "Another file" };
    const onOpen = vi.fn();
    const onUpdate = vi.fn();
    const view = render(
      <GitHubWorkspace
        document={local}
        documents={[local, another]}
        fileActionsTarget={actions}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const action = within(actions).getByRole("button", {
      name: "Move Notes to repository",
    });
    expect(action.hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("navigation", { name: "Workspace files" })
        .querySelector('button[title="Move to repository"]'),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move Another file to repository" }),
    ).toBeNull();
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await user.click(screen.getByRole("button", { name: "Local" }));
    expect(
      within(actions)
        .getByRole("button", { name: "Move Notes to repository" })
        .hasAttribute("disabled"),
    ).toBe(false);
    await user.click(
      within(actions).getByRole("button", { name: "Move Notes to repository" }),
    );
    expect(screen.getByLabelText("Destination directory")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    view.rerender(
      <GitHubWorkspace
        document={another}
        documents={[local, another]}
        fileActionsTarget={actions}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    expect(
      within(actions).queryByRole("button", {
        name: "Move Notes to repository",
      }),
    ).toBeNull();
    expect(
      within(actions).getByRole("button", {
        name: "Move Another file to repository",
      }),
    ).toBeDefined();
    view.rerender(
      <GitHubWorkspace
        document={{ ...another, github: origin }}
        documents={[local]}
        fileActionsTarget={actions}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    expect(
      within(actions).queryByRole("button", { name: /Move .*to repository/ }),
    ).toBeNull();
  });

  it("co-locates Add and Import in the rail and sends the selected workspace target", async () => {
    const onNew = vi.fn();
    const onImport = vi.fn();
    render(
      <GitHubWorkspace
        document={local}
        onNew={onNew}
        onImport={onImport}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const actions = screen.getByRole("group", {
      name: "Workspace file actions",
    });
    expect(actions.closest("aside")).not.toBeNull();
    await user.click(within(actions).getByRole("button", { name: "Add file" }));
    expect(onNew).toHaveBeenLastCalledWith(undefined, []);
    await user.click(
      within(actions).getByRole("button", { name: "Import Markdown" }),
    );
    expect(onImport).toHaveBeenLastCalledWith(undefined, []);
    await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await user.click(within(actions).getByRole("button", { name: "Add file" }));
    expect(onNew).toHaveBeenLastCalledWith(
      { repositoryId: 1, owner: "writer", repo: "notes", branch: "main" },
      expect.arrayContaining(["notes.md"]),
    );
    await user.click(
      within(actions).getByRole("button", { name: "Import Markdown" }),
    );
    expect(onImport).toHaveBeenLastCalledWith(
      expect.objectContaining({ repositoryId: 1 }),
      expect.arrayContaining(["notes.md"]),
    );
  });

  it("disables repository Add and Import until a GitHub connection is active", async () => {
    const onNew = vi.fn();
    const onImport = vi.fn();
    render(
      <GitHubWorkspace
        document={local}
        workspace="repository"
        selectedRepository={{
          repositoryId: 1,
          owner: "writer",
          repo: "notes",
          branch: "main",
        }}
        onNew={onNew}
        onImport={onImport}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const actions = screen.getByRole("group", {
      name: "Workspace file actions",
    });
    const add = within(actions).getByRole("button", { name: "Add file" });
    const importFile = within(actions).getByRole("button", {
      name: "Import Markdown",
    });
    expect(add.hasAttribute("disabled")).toBe(true);
    expect(importFile.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Connect GitHub to add or import files."),
    ).toBeDefined();
    await user.click(add);
    await user.click(importFile);
    expect(onNew).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();

    await connect();
    expect(add.hasAttribute("disabled")).toBe(false);
    expect(importFile.hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "GitHub settings" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(add.hasAttribute("disabled")).toBe(true);
    expect(importFile.hasAttribute("disabled")).toBe(true);
  });

  it("selects unpublished repo drafts from the tree without downloading or exposing them in Local", async () => {
    const draft: WorkspaceDocument = {
      ...local,
      id: "repo-draft",
      repository: {
        repositoryId: 1,
        owner: "writer",
        repo: "notes",
        branch: "main",
      },
      repositoryPath: "drafts/New.md",
    };
    const onSelect = vi.fn();
    render(
      <GitHubWorkspace
        document={draft}
        documents={[local, draft]}
        onSelect={onSelect}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New.md" }));
    expect(onSelect).toHaveBeenCalledWith("repo-draft");
    expect(GitHubClient.prototype.open).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Local" }));
    expect(screen.queryByRole("button", { name: "New.md" })).toBeNull();
    expect(
      screen
        .getByRole("region", { name: "Local drafts" })
        .querySelectorAll(".github-row"),
    ).toHaveLength(1);
  });

  it("publishes a repository draft only after explicit creation review", async () => {
    let draft: WorkspaceDocument = {
      ...local,
      id: "repo-draft",
      repository: {
        repositoryId: 1,
        owner: "writer",
        repo: "notes",
        branch: "main",
      },
      repositoryPath: "drafts/New.md",
    };
    const onOpen = vi.fn();
    const onUpdate = vi.fn(
      async (
        _id: string,
        update: (current: WorkspaceDocument) => WorkspaceDocument,
      ) => {
        draft = update(draft);
        view.rerender(
          <GitHubWorkspace
            document={draft}
            onOpen={onOpen}
            onUpdate={onUpdate}
          />,
        );
      },
    );
    const view = render(
      <GitHubWorkspace document={draft} onOpen={onOpen} onUpdate={onUpdate} />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await user.click(screen.getByRole("button", { name: "Create on GitHub" }));
    expect(screen.getByLabelText("Destination path").textContent).toBe(
      "drafts/New.md",
    );
    await user.click(screen.getByRole("button", { name: "Review creation" }));
    await screen.findByLabelText("Markdown changes");
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Create on GitHub",
      }),
    );
    await waitFor(() => expect(draft.github?.path).toBe("drafts/New.md"));
    expect(draft.id).toBe("repo-draft");
    expect(draft.content).toBe(local.content);
    expect(draft.repositoryPath).toBe("drafts/New.md");
    expect(draft.githubPending).toBeUndefined();
  });

  it("omits redundant workspace status labels but keeps browser-local save feedback", () => {
    const onOpen = vi.fn();
    const onUpdate = vi.fn();
    const view = render(
      <GitHubWorkspace
        document={local}
        onOpen={onOpen}
        onUpdate={onUpdate}
        localSaveState="saved"
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Saved locally")).toBeDefined();
    view.rerender(
      <GitHubWorkspace
        document={{ ...local, id: "" }}
        workspace="repository"
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reports document changes against the last GitHub check even while disconnected", () => {
    const onOpen = vi.fn();
    const onUpdate = vi.fn();
    const view = render(
      <GitHubWorkspace
        document={{ ...local, github: origin }}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Uncommitted changes");
    view.rerender(
      <GitHubWorkspace
        document={{ ...local, content: origin.baseContent, github: origin }}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Matches last GitHub check",
    );
  });

  it("keeps unconfirmed commit outcomes visible for files still in Local", () => {
    render(
      <GitHubWorkspace
        document={{
          ...local,
          githubPending: {
            candidateSha: "candidate",
            previousHead: "head",
            origin,
            operation: "create",
          },
        }}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Commit outcome unconfirmed",
    );
    expect(screen.getByRole("button", { name: "Check outcome" })).toBeDefined();
  });

  it("shows the GitHub connection action only in the Repository workspace", async () => {
    render(
      <GitHubWorkspace document={local} onOpen={vi.fn()} onUpdate={vi.fn()} />,
    );
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Repository" }));
    expect(
      screen.getByRole("button", { name: "Connect GitHub" }),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Local" }));
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
  });

  it("places local save status in the rail outside scrolling navigation", () => {
    render(
      <GitHubWorkspace
        document={local}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
        localSaveState="saving"
      />,
    );
    const status = screen.getByText("Saving");
    expect(status.closest("aside")).toBe(
      screen.getByRole("complementary", { name: "GitHub workspace" }),
    );
    expect(status.closest(".workspace-file-navigation")).toBeNull();
  });

  it("notifies repository selection once without overwriting it through a stale workspace callback", async () => {
    const onRepositoryChange = vi.fn();
    const onWorkspaceChange = vi.fn();
    render(
      <GitHubWorkspace
        document={local}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
        onRepositoryChange={onRepositoryChange}
        onWorkspaceChange={onWorkspaceChange}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await screen.findByRole("button", { name: "guide.md" });
    expect(onRepositoryChange).toHaveBeenCalledTimes(1);
    expect(onRepositoryChange).toHaveBeenCalledWith({
      repositoryId: 1,
      owner: "writer",
      repo: "notes",
      branch: "main",
    });
    expect(onWorkspaceChange).toHaveBeenCalledTimes(1);
    expect(onWorkspaceChange).toHaveBeenCalledWith("repository");
  });

  it("keeps every local draft separate and reopens cached repository files without downloading", async () => {
    const cached = {
      ...local,
      id: "cached",
      content: "Uncommitted local edits",
      github: origin,
    };
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    const onUpdate = vi.fn();
    render(
      <GitHubWorkspace
        document={local}
        documents={[local, cached]}
        onSelect={onSelect}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await screen.findByRole("button", { name: "guide.md" });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Local drafts" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "notes.md" }));
    expect(onSelect).toHaveBeenLastCalledWith("cached");
    expect(GitHubClient.prototype.open).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Local" }));
    const localGroup = screen.getByRole("region", { name: "Local drafts" });
    expect(localGroup.querySelectorAll(".github-row")).toHaveLength(1);
    expect(
      screen.queryByRole("region", { name: "Repository files" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(onSelect).toHaveBeenLastCalledWith(local.id);
  });

  it("switches branches as a whole tree and opens nested Markdown directly", async () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    vi.mocked(GitHubClient.prototype.open).mockResolvedValue({
      ...origin,
      path: "docs/deep/guide.md",
      branch: "docs/topic",
    });
    render(
      <GitHubWorkspace document={local} onOpen={onOpen} onUpdate={vi.fn()} />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    expect(
      screen
        .getByLabelText("Repository branch")
        .closest(".workspace-file-navigation"),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Refresh repository listing" })
        .closest(".workspace-file-navigation"),
    ).toBeNull();
    await user.selectOptions(
      screen.getByLabelText("Repository branch"),
      "docs/topic",
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "guide.md" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "guide.md" }));
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: "docs/topic",
          path: "docs/deep/guide.md",
        }),
      ),
    );
    expect(GitHubClient.prototype.markdownFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ branch: "docs/topic" }),
      "tree",
      true,
    );
    expect(GitHubClient.prototype.open).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "docs/topic" }),
      "docs/deep/guide.md",
      { sha: "head", tree: { sha: "tree" } },
    );
  });

  it("keeps cached files available when they disappear from the repository listing", async () => {
    const cached = {
      ...local,
      id: "cached",
      github: { ...origin, path: "removed.md" },
    };
    const onSelect = vi.fn();
    render(
      <GitHubWorkspace
        document={local}
        documents={[local, cached]}
        onSelect={onSelect}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await screen.findByRole("button", { name: "guide.md" });
    expect(
      screen.getByRole("region", { name: "Repository working copies" })
        .textContent,
    ).toContain("removed.md");
    await user.click(screen.getByRole("button", { name: "removed.md" }));
    expect(onSelect).toHaveBeenCalledWith("cached");
  });

  it("moves a local file into a chosen directory only after its reviewed commit succeeds", async () => {
    let current: WorkspaceDocument = { ...local, name: "Quarter / Q4: plans?" };
    const originalId = current.id;
    const onOpen = vi.fn();
    const onUpdate = vi.fn(
      async (
        _id: string,
        update: (document: WorkspaceDocument) => WorkspaceDocument,
      ) => {
        current = update(current);
        view.rerender(
          <GitHubWorkspace
            document={current}
            documents={[current]}
            onSelect={vi.fn()}
            onOpen={onOpen}
            onUpdate={onUpdate}
          />,
        );
      },
    );
    let publish!: () => void;
    vi.mocked(GitHubClient.prototype.publish).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          publish = () => resolve({ object: { sha: "candidate" } });
        }),
    );
    const view = render(
      <GitHubWorkspace
        document={current}
        documents={[current]}
        onSelect={vi.fn()}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.click(
      screen.getByRole("button", {
        name: "Move Quarter / Q4: plans? to repository",
      }),
    );
    expect(
      (screen.getByLabelText("Repository filename") as HTMLInputElement).value,
    ).toBe("Quarter-Q4-plans.md");
    await user.selectOptions(
      screen.getByLabelText("Destination directory"),
      "docs/deep",
    );
    expect(screen.getByLabelText("Destination path").textContent).toBe(
      "docs/deep/Quarter-Q4-plans.md",
    );
    await user.click(screen.getByRole("button", { name: "Review move" }));
    await screen.findByLabelText("Markdown changes");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Move to repository" }),
    );
    await waitFor(() =>
      expect(GitHubClient.prototype.publish).toHaveBeenCalledTimes(1),
    );
    expect(documentRepository(current)).toBeUndefined();
    expect(current.githubPending?.candidateSha).toBe("candidate");
    const dialog = screen.getByRole("dialog");
    expect(
      screen.getByRole("button", { name: "Close GitHub" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(current.githubPending?.candidateSha).toBe("candidate");
    publish();
    await waitFor(() =>
      expect(current.github?.path).toBe("docs/deep/Quarter-Q4-plans.md"),
    );
    expect(current.id).toBe(originalId);
    expect(current.content).toBe(local.content);
    expect(current.githubPending).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    expect(
      screen.getByRole("button", { name: "Quarter-Q4-plans.md" }),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Local" }));
    expect(
      screen
        .getByRole("region", { name: "Local drafts" })
        .querySelectorAll(".github-row"),
    ).toHaveLength(0);
  });

  it("warns on the translated filename collision and cancels without matching or overwriting", async () => {
    vi.mocked(GitHubClient.prototype.markdownFiles).mockResolvedValue([
      { path: "docs/Notes.md", type: "blob", mode: "100644", sha: "existing" },
      { path: "assets", type: "tree", mode: "040000", sha: "assets-tree" },
    ]);
    const onUpdate = vi.fn();
    render(
      <GitHubWorkspace document={local} onOpen={vi.fn()} onUpdate={onUpdate} />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.click(
      screen.getByRole("button", { name: "Move Notes to repository" }),
    );
    await user.selectOptions(
      screen.getByLabelText("Destination directory"),
      "docs",
    );
    expect(screen.getByRole("alert").textContent).toContain("docs/Notes.md");
    expect(
      screen
        .getByRole("button", { name: "Review move" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("option", { name: "assets" })).toBeDefined();
    await user.selectOptions(
      screen.getByLabelText("Destination directory"),
      "__new_directory__",
    );
    await user.type(screen.getByLabelText("New directory path"), "drafts/new");
    expect(screen.getByLabelText("Destination path").textContent).toBe(
      "drafts/new/Notes.md",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(GitHubClient.prototype.createCommit).not.toHaveBeenCalled();
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
  });

  it("retains local ownership when GitHub rejects a move", async () => {
    let current: WorkspaceDocument = { ...local };
    const onOpen = vi.fn();
    const onUpdate = vi.fn(
      async (
        _id: string,
        update: (document: WorkspaceDocument) => WorkspaceDocument,
      ) => {
        current = update(current);
        view.rerender(
          <GitHubWorkspace
            document={current}
            onOpen={onOpen}
            onUpdate={onUpdate}
          />,
        );
      },
    );
    vi.mocked(GitHubClient.prototype.publish).mockRejectedValueOnce(
      new GitHubError("Branch policy rejected the move", 403),
    );
    const view = render(
      <GitHubWorkspace
        document={current}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.click(
      screen.getByRole("button", { name: "Move Notes to repository" }),
    );
    await user.selectOptions(
      screen.getByLabelText("Destination directory"),
      "__new_directory__",
    );
    await user.type(screen.getByLabelText("New directory path"), "drafts/new");
    await user.clear(screen.getByLabelText("Repository filename"));
    await user.type(screen.getByLabelText("Repository filename"), "Retry.md");
    await user.click(screen.getByRole("button", { name: "Review move" }));
    await screen.findByLabelText("Markdown changes");
    await user.click(
      screen.getByRole("button", { name: "Move to repository" }),
    );
    await screen.findByRole("alert");
    expect(current.id).toBe(local.id);
    expect(documentRepository(current)).toBeUndefined();
    expect(current.githubPending).toBeUndefined();
    expect(current.content).toBe(local.content);
    expect(screen.getByLabelText("Destination path").textContent).toBe(
      "drafts/new/Retry.md",
    );
    expect(screen.queryByLabelText("Markdown changes")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review move" }));
    await screen.findByLabelText("Markdown changes");
    await user.click(
      screen.getByRole("button", { name: "Move to repository" }),
    );
    await waitFor(() =>
      expect(current.github?.path).toBe("drafts/new/Retry.md"),
    );
    expect(GitHubClient.prototype.publish).toHaveBeenCalledTimes(2);
  });

  it("never puts repository-only working copies into Local", async () => {
    const retained = {
      ...local,
      id: "retained",
      name: "Deleted remote copy",
      repository: {
        repositoryId: 1,
        owner: "writer",
        repo: "notes",
        branch: "main",
      },
    };
    render(
      <GitHubWorkspace
        document={local}
        documents={[local, retained]}
        onOpen={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Local drafts" }).textContent,
    ).not.toContain("Deleted remote copy");
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    expect(
      screen.getByRole("region", { name: "Repository working copies" })
        .textContent,
    ).toContain("Deleted remote copy");
    expect(screen.queryByRole("region", { name: "Local drafts" })).toBeNull();
  });

  it("clears token input and remote listings on disconnect without storing credentials", async () => {
    const persistCredential = vi.fn();
    vi.stubGlobal("localStorage", { setItem: persistCredential });
    vi.stubGlobal("sessionStorage", { setItem: persistCredential });
    render(
      <GitHubWorkspace document={local} onOpen={vi.fn()} onUpdate={vi.fn()} />,
    );
    const user = await connect();
    expect(screen.queryByLabelText("Personal access token")).toBeNull();
    expect(persistCredential).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(
      (screen.getByLabelText("Personal access token") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(screen.queryByRole("button", { name: "writer/notes" })).toBeNull();
  });

  it("opens a linked draft from a pinned branch snapshot", async () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(
      <GitHubWorkspace document={local} onOpen={onOpen} onUpdate={vi.fn()} />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await screen.findByRole("button", { name: "notes.md" });
    expect(
      screen.getByRole("button", { name: "guide.md" }).closest("nav"),
    ).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(GitHubClient.prototype.open).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "notes.md" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(origin));
    expect(GitHubClient.prototype.open).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "main" }),
      "notes.md",
      { sha: "head", tree: { sha: "tree" } },
    );
  });

  it("requires source review and preserves edits made after the reviewed snapshot", async () => {
    let current: WorkspaceDocument = { ...local, github: origin };
    const onOpen = vi.fn();
    const onUpdate = vi.fn(
      async (
        _id: string,
        update: (document: WorkspaceDocument) => WorkspaceDocument,
      ) => {
        current = update(current);
      },
    );
    const view = render(
      <GitHubWorkspace
        document={current}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    await screen.findByLabelText("Markdown changes");
    expect(screen.getByLabelText("Markdown changes").textContent).toContain(
      "+Edited",
    );
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
    current = { ...current, content: "Later edits\n" };
    view.rerender(
      <GitHubWorkspace
        document={current}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Commit to GitHub" }));
    await waitFor(() => expect(current.github?.blobSha).toBe("new-blob"));
    expect(current.content).toBe("Later edits\n");
    expect(current.github?.baseContent).toBe("Edited\n");
    expect(onUpdate.mock.calls[0][0]).toBe(local.id);
    expect(current.githubPending).toBeUndefined();
  });

  it("retains recovery metadata after a lost publication response", async () => {
    vi.mocked(GitHubClient.prototype.publish).mockRejectedValueOnce(
      new GitHubError("Outcome uncertain", 0, true),
    );
    let current: WorkspaceDocument = { ...local, github: origin };
    const onOpen = vi.fn();
    const onUpdate = vi.fn(
      async (
        _id: string,
        update: (document: WorkspaceDocument) => WorkspaceDocument,
      ) => {
        current = update(current);
        view.rerender(
          <GitHubWorkspace
            document={current}
            onOpen={onOpen}
            onUpdate={onUpdate}
          />,
        );
      },
    );
    const view = render(
      <GitHubWorkspace
        document={current}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    await screen.findByLabelText("Markdown changes");
    await user.click(screen.getByRole("button", { name: "Commit to GitHub" }));
    await screen.findByRole("alert");
    expect(current.githubPending?.candidateSha).toBe("candidate");
    expect(GitHubClient.prototype.publish).toHaveBeenCalledTimes(1);
    vi.mocked(GitHubClient.prototype.head).mockResolvedValueOnce({
      sha: "candidate",
      tree: { sha: "new-tree" },
    });
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Check outcome" }));
    await waitFor(() => expect(current.githubPending).toBeUndefined());
    expect(current.github?.commitSha).toBe("candidate");
    expect(GitHubClient.prototype.publish).toHaveBeenCalledTimes(1);
  });

  it("does not publish when local pending recovery cannot be persisted", async () => {
    const onUpdate = vi
      .fn()
      .mockRejectedValue(new Error("IndexedDB unavailable"));
    render(
      <GitHubWorkspace
        document={{ ...local, github: origin }}
        onOpen={vi.fn()}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    await screen.findByLabelText("Markdown changes");
    await user.click(screen.getByRole("button", { name: "Commit to GitHub" }));
    await screen.findByRole("alert");
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
  });

  it("saves the current draft as a Local copy without replacing or publishing it", async () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn();
    const onSaveLocalCopy = vi.fn().mockResolvedValue(undefined);
    render(
      <GitHubWorkspace
        document={{ ...local, github: origin }}
        onSaveLocalCopy={onSaveLocalCopy}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const user = await connect();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Sync with GitHub" }));
    await screen.findByLabelText("GitHub versus local Markdown");
    expect(onUpdate).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Save draft as Local copy" }),
    );
    await waitFor(() =>
      expect(onSaveLocalCopy).toHaveBeenCalledWith({
        ...local,
        github: origin,
      }),
    );
    expect(onOpen).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(GitHubClient.prototype.publish).not.toHaveBeenCalled();
  });

  it("keeps the dialog open during publication and traps Escape through native dialog cancellation", async () => {
    render(
      <GitHubWorkspace document={local} onOpen={vi.fn()} onUpdate={vi.fn()} />,
    );
    await connect();
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog.hasAttribute("open")).toBe(false);
  });
});
