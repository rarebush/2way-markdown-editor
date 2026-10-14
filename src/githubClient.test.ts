import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubClient,
  GitHubError,
  decodeMarkdown,
  encodeMarkdown,
  parseRepository,
  validateMarkdownPath,
} from "./githubClient";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub transport", () => {
  it("accepts repository URLs but rejects credential-bearing and external URLs", () => {
    expect(parseRepository("https://github.com/writer/notes.git/")).toEqual({
      owner: "writer",
      repo: "notes",
    });
    for (const input of [
      "https://user:secret@github.com/writer/notes",
      "https://evil.test/writer/notes",
      "writer/notes/extra",
      "https://github.com/writer/notes?token=secret",
    ]) {
      expect(() => parseRepository(input)).toThrow();
    }
  });

  it("rejects unsafe and non-Markdown destinations", () => {
    expect(validateMarkdownPath("日本語/notes #1.MD")).toBe(
      "日本語/notes #1.MD",
    );
    for (const path of [
      "../notes.md",
      "/notes.md",
      "a//notes.md",
      "a\\notes.md",
      ".github/workflows/notes.md",
      "image.png",
    ])
      expect(() => validateMarkdownPath(path)).toThrow();
  });

  it("preserves Unicode, BOM, CRLF and trailing newline", () => {
    const content = "\ufeff# 日本語 📝\r\n";
    expect(decodeMarkdown(encodeMarkdown(content))).toBe(content);
    expect(() => decodeMarkdown("/w==")).toThrow("UTF-8");
    expect(() => encodeMarkdown("x".repeat(1024 * 1024 + 1))).toThrow("1 MiB");
  });

  it("sends credentials only to the API host and loads repositories by page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    await new GitHubClient("test-token").repositories(2);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.origin).toBe("https://api.github.com");
    expect(url.searchParams.get("page")).toBe("2");
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(options.redirect).toBe("error");
    expect(options.credentials).toBe("omit");
  });

  it("encodes branch names and never force pushes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"object":{"sha":"new"}}'));
    vi.stubGlobal("fetch", fetchMock);
    await new GitHubClient("test-token").publish(
      { repositoryId: 1, owner: "writer", repo: "notes", branch: "docs/topic" },
      "new",
    );
    expect(fetchMock.mock.calls[0][0].pathname).toContain("docs%2Ftopic");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      sha: "new",
      force: false,
    });
  });

  it("refuses truncated trees", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"tree":[],"truncated":true}')),
    );
    await expect(
      new GitHubClient("test-token").tree(
        { repositoryId: 1, owner: "writer", repo: "notes", branch: "main" },
        "tree",
      ),
    ).rejects.toThrow("incomplete");
  });

  it("lists all nested Markdown paths without fetching file contents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          truncated: false,
          tree: [
            { path: "notes.md", type: "blob", mode: "100644", sha: "first" },
            {
              path: "docs/deep/guide.MD",
              type: "blob",
              mode: "100755",
              sha: "nested",
            },
            {
              path: "docs/image.png",
              type: "blob",
              mode: "100644",
              sha: "image",
            },
            { path: "link.md", type: "blob", mode: "120000", sha: "symlink" },
            {
              path: ".github/workflows/notes.md",
              type: "blob",
              mode: "100644",
              sha: "workflow",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const files = await new GitHubClient("test-token").markdownFiles(
      { repositoryId: 1, owner: "writer", repo: "notes", branch: "main" },
      "tree",
    );
    expect(files.map((entry) => entry.path)).toEqual([
      "docs/deep/guide.MD",
      "notes.md",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].searchParams.get("recursive")).toBe("1");
  });

  it("walks complete subtrees when the recursive result is truncated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ truncated: true, tree: [] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: "docs", type: "tree", mode: "040000", sha: "docs-tree" },
              { path: "notes.md", type: "blob", mode: "100644", sha: "first" },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: "guide.md", type: "blob", mode: "100644", sha: "nested" },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const files = await new GitHubClient("test-token").markdownFiles(
      { repositoryId: 1, owner: "writer", repo: "notes", branch: "main" },
      "root-tree",
    );
    expect(files.map((entry) => entry.path)).toEqual([
      "docs/guide.md",
      "notes.md",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("includes asset-only directories for the explicit move destination picker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              {
                path: "assets",
                type: "tree",
                mode: "040000",
                sha: "assets-tree",
              },
              {
                path: "assets/image.png",
                type: "blob",
                mode: "100644",
                sha: "image",
              },
            ],
          }),
        ),
      ),
    );
    const entries = await new GitHubClient("test-token").markdownFiles(
      { repositoryId: 1, owner: "writer", repo: "notes", branch: "main" },
      "tree",
      true,
    );
    expect(entries.map((entry) => entry.path)).toEqual(["assets"]);
  });

  it("categorizes rate limits without exposing response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"message":"private content"}', {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "123",
          },
        }),
      ),
    );
    await expect(
      new GitHubClient("test-token").identity(),
    ).rejects.toMatchObject({
      status: 403,
      retryAt: 123000,
      message: expect.stringContaining("rate limit"),
    });
  });

  it("marks failed publication outcomes uncertain, but not failed reads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const client = new GitHubClient("test-token");
    await expect(client.identity()).rejects.toMatchObject({ uncertain: false });
    await expect(
      client.publish(
        { repositoryId: 1, owner: "writer", repo: "notes", branch: "main" },
        "new",
      ),
    ).rejects.toMatchObject({ uncertain: true });
    expect(new GitHubError("Conflict", 409).uncertain).toBe(false);
  });
});
