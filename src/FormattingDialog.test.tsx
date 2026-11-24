// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormattingDialog } from "./FormattingDialog";
import { defaultFormattingPreferences } from "./formattingPreferences";

afterEach(cleanup);

describe("formatting settings", () => {
  it("saves a document override and requires saving before review", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {});
    render(
      <FormattingDialog
        scope="document"
        preferences={defaultFormattingPreferences}
        globalPreferences={defaultFormattingPreferences}
        hasOverride={false}
        onSave={save}
        onClose={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Document formatting" });
    expect(within(dialog).getByLabelText("Horizontal rules").matches(":disabled")).toBe(true);
    await user.click(within(dialog).getByLabelText("Use global preferences"));
    await user.selectOptions(within(dialog).getByLabelText("Horizontal rules"), "-");
    expect(within(dialog).getByRole("button", { name: "Review formatting" }).matches(":disabled")).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Save preferences" }));
    expect(save).toHaveBeenCalledWith({ ...defaultFormattingPreferences, rule: "-" });
  });

  it("displays the inherited global settings and clears the override", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {});
    render(
      <FormattingDialog
        scope="document"
        preferences={{ ...defaultFormattingPreferences, rule: "_" }}
        globalPreferences={{ ...defaultFormattingPreferences, rule: "-" }}
        hasOverride
        onSave={save}
        onClose={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText("Use global preferences"));
    expect((screen.getByLabelText("Horizontal rules") as HTMLSelectElement).value).toBe("-");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(save).toHaveBeenCalledWith(null);
  });
});
