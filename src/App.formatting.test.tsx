// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { useImperativeHandle, type Ref } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "./documents";
import type { FormattingPreferences } from "./formattingPreferences";
import type { MarkdownSurfaceHandle } from "./MarkdownSurface";
import App from "./App";

vi.mock("./GitHubWorkspace", () => ({ GitHubWorkspace: () => null }));
vi.mock("./MarkdownSurface", () => ({
  MarkdownSurface: ({
    ref,
    value,
    formatting,
    onChange,
    onFormattingSettings,
  }: {
    ref: Ref<MarkdownSurfaceHandle>;
    value: string;
    formatting: FormattingPreferences;
    onChange: (value: string, origin: "source") => void;
    onFormattingSettings: () => void;
  }) => {
    useImperativeHandle(ref, () => ({
      prepareFormatting: (markdown) => markdown.replace("***", formatting.rule.repeat(3)),
    }), [formatting]);
    return (
      <>
        <button onClick={onFormattingSettings}>Document formatting settings</button>
        <textarea aria-label="Markdown source" value={value} onChange={(event) => onChange(event.target.value, "source")} />
      </>
    );
  },
}));

let draftId = "";
beforeEach(async () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  const draft = storage.createDocument("Formatting test", "First\n\n***\n\nTail\n");
  draftId = draft.id;
  await storage.saveDocument(draft);
});

afterEach(async () => {
  cleanup();
  await storage.deleteDocument(draftId);
  vi.unstubAllGlobals();
});

describe("formatting review workflow", () => {
  it("persists a document override independently of global settings", async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await screen.findByRole("heading", { name: "Formatting test" });
    await user.click(screen.getByRole("button", { name: "Document formatting settings" }));
    await user.click(screen.getByLabelText("Use global preferences"));
    await user.selectOptions(screen.getByLabelText("Horizontal rules"), "_");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(async () => {
      const saved = (await storage.listDocuments()).find((item) => item.id === draftId);
      expect(saved?.formatting?.rule).toBe("_");
      expect(saved?.content).toBe("First\n\n***\n\nTail\n");
    });
    app.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "Formatting test" });
    await user.click(screen.getByRole("button", { name: "Document formatting settings" }));
    expect((screen.getByLabelText("Use global preferences") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Horizontal rules") as HTMLSelectElement).value).toBe("_");
  });

  it("does not rewrite until the reviewed changes are confirmed", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Formatting test" });
    await user.click(screen.getByRole("button", { name: "Formatting preferences" }));
    await user.selectOptions(screen.getByLabelText("Horizontal rules"), "-");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    expect((screen.getByLabelText("Markdown source") as HTMLTextAreaElement).value).toContain("***");

    await user.click(screen.getByRole("button", { name: "Document formatting settings" }));
    await user.click(screen.getByRole("button", { name: "Review formatting" }));
    const review = screen.getByRole("dialog", { name: "Review formatting" });
    expect(within(review).getByLabelText("Formatting changes").textContent).toContain("-***");
    expect(within(review).getByLabelText("Formatting changes").textContent).toContain("+---");
    await user.click(within(review).getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText("Markdown source") as HTMLTextAreaElement).value).toContain("***");

    await user.click(screen.getByRole("button", { name: "Document formatting settings" }));
    await user.click(screen.getByRole("button", { name: "Review formatting" }));
    await user.click(screen.getByRole("button", { name: "Apply formatting" }));
    expect((screen.getByLabelText("Markdown source") as HTMLTextAreaElement).value).toContain("---");
    await waitFor(async () => {
      expect((await storage.listDocuments()).find((item) => item.id === draftId)?.content).toContain("---");
    });
  });

  it("rejects a stale review if the draft changes before confirmation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Formatting test" });
    await user.click(screen.getByRole("button", { name: "Formatting preferences" }));
    await user.selectOptions(screen.getByLabelText("Horizontal rules"), "-");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await user.click(screen.getByRole("button", { name: "Document formatting settings" }));
    await user.click(screen.getByRole("button", { name: "Review formatting" }));
    fireEvent.change(screen.getByLabelText("Markdown source"), { target: { value: "Newer edit\n" } });
    await user.click(screen.getByRole("button", { name: "Apply formatting" }));
    expect(screen.getByRole("alert").textContent).toContain("changed");
    expect((screen.getByLabelText("Markdown source") as HTMLTextAreaElement).value).toBe("Newer edit\n");
  });
});
