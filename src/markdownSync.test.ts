import { describe, expect, it } from "vitest";
import { shouldReplaceRichDocument } from "./markdownSync";

describe("Markdown edit origin", () => {
  it("does not replace newer rich typing with an older rich snapshot", () => {
    const emittedSnapshot = "Text at position 403";
    const liveAfterNextKeystroke = `${emittedSnapshot}!`;
    expect(shouldReplaceRichDocument("rich", emittedSnapshot, liveAfterNextKeystroke)).toBe(false);
  });

  it("never feeds a rich editor snapshot back into its originating editor", () => {
    expect(shouldReplaceRichDocument("rich", "*emphasis*", "_emphasis_")).toBe(false);
    expect(shouldReplaceRichDocument("rich", "same", "same")).toBe(false);
  });

  it("replaces the rich document for changed source or external content", () => {
    expect(shouldReplaceRichDocument("source", "New source", "Old preview")).toBe(true);
    expect(shouldReplaceRichDocument(undefined, "Imported text", "Old preview")).toBe(true);
  });

  it("avoids replacements when source and live content already agree", () => {
    expect(shouldReplaceRichDocument("source", "same", "same")).toBe(false);
  });
});