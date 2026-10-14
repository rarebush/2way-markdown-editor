// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createDocument,
  deleteDocument,
  listDocuments,
  saveDocument,
} from "./documents";

vi.mock("./MarkdownSurface", () => ({
  MarkdownSurface: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (content: string, origin: "source") => void;
  }) => (
    <textarea
      aria-label="Markdown draft"
      value={value}
      onChange={(event) => onChange(event.target.value, "source")}
    />
  ),
}));

function githubNetwork() {
  const repository = {
    id: 1,
    full_name: "writer/notes",
    name: "notes",
    owner: { login: "writer" },
    default_branch: "main",
    archived: false,
  };
  const root = "/repos/writer/notes";
  let head = "head";
  let losePublicationResponse = false;
  const requests: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const path = url.pathname;
    requests.push(`${method} ${path}`);
    if (url.origin !== "https://api.github.com")
      throw new Error(`Unexpected origin: ${url.origin}`);
    if (method === "GET") {
      if (path === "/user") return json({ login: "writer" });
      if (path === "/user/repos") return json([repository]);
      if (path === root) return json(repository);
      if (path === `${root}/branches`) return json([{ name: "main" }]);
      if (path === `${root}/git/ref/heads/main`)
        return json({ ref: "refs/heads/main", object: { sha: head } });
      if (path === `${root}/git/commits/${head}`)
        return json({ sha: head, tree: { sha: "tree" } });
      if (path === `${root}/git/trees/tree`)
        return json({
          truncated: false,
          tree: [
            { path: "remote.md", type: "blob", mode: "100644", sha: "blob" },
          ],
        });
      if (path === `${root}/git/blobs/blob`)
        return json({ encoding: "base64", content: btoa("Remote Markdown\n") });
    }
    if (method === "POST") {
      if (path === `${root}/git/blobs`) return json({ sha: "new-blob" });
      if (path === `${root}/git/trees`) return json({ sha: "new-tree" });
      if (path === `${root}/git/commits`) return json({ sha: "candidate" });
    }
    if (method === "PATCH" && path === `${root}/git/refs/heads/main`) {
      head = "candidate";
      if (losePublicationResponse) throw new TypeError("Connection lost");
      return json({ object: { sha: head } });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  return {
    requests,
    losePublicationResponse() {
      losePublicationResponse = true;
    },
  };
}

beforeEach(async () => {
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
  for (const document of await listDocuments())
    await deleteDocument(document.id);
  await saveDocument(createDocument("Local notes", "Local Markdown"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Repository" }),
  );
  await user.click(screen.getByRole("button", { name: "Connect GitHub" }));
  await user.type(
    screen.getByLabelText("Personal access token"),
    "test-only-pat",
  );
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByRole("button", { name: "writer/notes" });
}

async function openRemote(user: ReturnType<typeof userEvent.setup>) {
  await connect(user);
  await user.click(screen.getByRole("button", { name: "writer/notes" }));
  await screen.findByRole("button", { name: "remote.md" });
  await user.click(
    screen.getByRole("button", { name: "remote.md" }),
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Markdown draft") as HTMLTextAreaElement).value,
    ).toBe("Remote Markdown\n"),
  );
}

describe("App and GitHub workspace integration", () => {
  it("reopens a cached draft without fetching or overwriting edits and restores it offline", async () => {
    const network = githubNetwork();
    const user = userEvent.setup();
    const view = render(<App />);
    await screen.findByLabelText("Markdown draft");
    await openRemote(user);
    await user.clear(screen.getByLabelText("Markdown draft"));
    await user.type(screen.getByLabelText("Markdown draft"), "Uncommitted draft");
    await user.click(screen.getByRole("button", { name: "Local" }));
    expect(
      (screen.getByLabelText("Markdown draft") as HTMLTextAreaElement).value,
    ).toBe("Local Markdown");
    await user.click(
      screen.getByRole("button", { name: "Repository" }),
    );
    const requestCount = network.requests.length;
    await user.click(
      screen.getByRole("button", { name: "remote.md" }),
    );
    expect(
      (screen.getByLabelText("Markdown draft") as HTMLTextAreaElement).value,
    ).toBe("Uncommitted draft");
    expect(network.requests).toHaveLength(requestCount);
    await screen.findByText("Saved locally");
    view.unmount();

    render(<App />);
    await screen.findByLabelText("Markdown draft");
    expect(
      (screen.getByLabelText("Markdown draft") as HTMLTextAreaElement).value,
    ).toBe("Uncommitted draft");
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeDefined();
    expect(network.requests).toHaveLength(requestCount);
  });

  it("moves a Local draft only after review and restores its repository ownership on reload", async () => {
    const network = githubNetwork();
    const user = userEvent.setup();
    const view = render(<App />);
    await screen.findByLabelText("Markdown draft");
    await connect(user);
    await user.click(screen.getByRole("button", { name: "writer/notes" }));
    await screen.findByRole("button", { name: "remote.md" });
    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.click(
      screen.getByRole("button", { name: "Move Local notes to repository" }),
    );
    await user.click(screen.getByRole("button", { name: "Review move" }));
    await screen.findByLabelText("Markdown changes");
    expect(
      network.requests.some((request) => request.startsWith("POST")),
    ).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "Move to repository" }),
    );
    await screen.findByText("Committed to writer/notes on main.");
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    expect(
      screen.getByRole("button", { name: "Local-notes.md" }),
    ).toBeDefined();
    expect(
      (screen.getByLabelText("Markdown draft") as HTMLTextAreaElement).value,
    ).toBe("Local Markdown");
    await user.click(screen.getByRole("button", { name: "Local" }));
    expect(
      within(screen.getByRole("region", { name: "Local drafts" })).queryByRole(
        "button",
        { name: "Local notes" },
      ),
    ).toBeNull();
    expect(screen.queryByLabelText("Markdown draft")).toBeNull();
    view.unmount();

    render(<App />);
    await screen.findByLabelText("Markdown draft");
    expect(
      (screen.getByLabelText("Markdown draft") as HTMLTextAreaElement).value,
    ).toBe("Local Markdown");
    expect(screen.getByText("Matches last GitHub check")).toBeDefined();
    expect(
      network.requests.filter((request) => request.startsWith("PATCH")),
    ).toHaveLength(1);
  });

  it("recovers an unconfirmed publication after reload without publishing twice", async () => {
    const network = githubNetwork();
    network.losePublicationResponse();
    const user = userEvent.setup();
    const view = render(<App />);
    await screen.findByLabelText("Markdown draft");
    await openRemote(user);
    await user.clear(screen.getByLabelText("Markdown draft"));
    await user.type(screen.getByLabelText("Markdown draft"), "Reviewed content");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));
    await screen.findByLabelText("Markdown changes");
    await user.click(screen.getByRole("button", { name: "Commit to GitHub" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Commit outcome unconfirmed")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await screen.findByText("Saved locally");
    view.unmount();

    render(<App />);
    await screen.findByLabelText("Markdown draft");
    expect(screen.getByText("Commit outcome unconfirmed")).toBeDefined();
    expect(
      (screen.getByLabelText("Markdown draft") as HTMLTextAreaElement).value,
    ).toBe("Reviewed content");
    await connect(user);
    await user.click(screen.getByRole("button", { name: "Close GitHub" }));
    await user.click(screen.getByRole("button", { name: "Check outcome" }));
    await screen.findByText(
      "The commit was published. Its local link has been recovered.",
    );
    expect(screen.queryByText("Commit outcome unconfirmed")).toBeNull();
    expect(screen.getByText("Matches last GitHub check")).toBeDefined();
    expect(
      network.requests.filter((request) => request.startsWith("PATCH")),
    ).toHaveLength(1);
    expect(
      network.requests.filter(
        (request) => request === "POST /repos/writer/notes/git/commits",
      ),
    ).toHaveLength(1);
  });
});
