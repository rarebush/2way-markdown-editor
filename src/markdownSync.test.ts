import { describe, expect, it } from "vitest";
import {
  differencesWereApproved,
  getRoundTripDifferences,
  isProgrammaticRichEcho,
  shouldReplaceRichDocument,
} from "./markdownSync";

describe("Markdown edit origin", () => {
  it("recognizes previously approved round-trip differences but not new ones", () => {
    const source = "---\ntitle: Test\n---\n\nPlain text.\n";
    const serialized = "***\n\n## title: Test\n\nPlain text.\n";
    const approved = getRoundTripDifferences(source, serialized)!;
    expect(approved.size).toBeGreaterThan(0);
    const unchangedRisk = getRoundTripDifferences(
      `${source}More text.\n`,
      `${serialized}More text.\n`,
    )!;
    expect(differencesWereApproved(unchangedRisk, approved)).toBe(true);
    const newRisk = getRoundTripDifferences(
      `${source}\n> [!WARNING]\n`,
      `${serialized}\n> \\[!WARNING]\n`,
    )!;
    expect(differencesWereApproved(newRisk, approved)).toBe(false);
    expect(getRoundTripDifferences("same", "same")?.size).toBe(0);
  });

  it("identifies a matching serialization echo from a source replacement", () => {
    expect(
      isProgrammaticRichEcho(
        "canonical preview Markdown",
        "canonical preview Markdown",
      ),
    ).toBe(true);
    expect(
      isProgrammaticRichEcho("new rich edit", "canonical preview Markdown"),
    ).toBe(false);
    expect(isProgrammaticRichEcho("any rich edit", null)).toBe(false);
  });

  it("does not replace newer rich typing with an older rich snapshot", () => {
    const emittedSnapshot = "Text at position 403";
    const liveAfterNextKeystroke = `${emittedSnapshot}!`;
    expect(
      shouldReplaceRichDocument(
        "rich",
        emittedSnapshot,
        liveAfterNextKeystroke,
      ),
    ).toBe(false);
  });

  it("never feeds a rich editor snapshot back into its originating editor", () => {
    expect(shouldReplaceRichDocument("rich", "*emphasis*", "_emphasis_")).toBe(
      false,
    );
    expect(shouldReplaceRichDocument("rich", "same", "same")).toBe(false);
  });

  it("replaces the rich document for changed source or external content", () => {
    expect(
      shouldReplaceRichDocument("source", "New source", "Old preview"),
    ).toBe(true);
    expect(
      shouldReplaceRichDocument(undefined, "Imported text", "Old preview"),
    ).toBe(true);
  });

  it("avoids replacements when source and live content already agree", () => {
    expect(shouldReplaceRichDocument("source", "same", "same")).toBe(false);
  });
});
