import { describe, expect, it } from "vitest";
import { highlightTree, tags } from "@lezer/highlight";
import {
  sourceMarkdownHighlightStyle,
  sourceMarkdownLanguage,
} from "./sourceMarkdown";

describe("source Markdown styling", () => {
  it("recognizes GFM strikethrough, tasks, and tables", () => {
    const source = [
      "~~removed~~",
      "",
      "- [x] Completed task",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | beta |",
    ].join("\n");
    const tree = sourceMarkdownLanguage.language.parser.parse(source);

    expect(tree.toString()).toContain("Strikethrough");
    expect(tree.toString()).toContain("TaskMarker");
    expect(tree.toString()).toContain("Table");
  });

  it("highlights struck text rather than leaving it as plain source", () => {
    const source = "~~removed~~";
    const highlighted: { text: string; classes: string }[] = [];
    highlightTree(
      sourceMarkdownLanguage.language.parser.parse(source),
      sourceMarkdownHighlightStyle,
      (from, to, classes) => {
        highlighted.push({ text: source.slice(from, to), classes });
      },
    );

    const strikeClass = sourceMarkdownHighlightStyle.style([tags.strikethrough]);
    expect(strikeClass).toBeTruthy();
    expect(
      highlighted.some(
        (token) => token.text.includes("removed") && token.classes === strikeClass,
      ),
    ).toBe(true);
  });

  it("distinguishes heading emphasis from underlined links", () => {
    const heading = sourceMarkdownHighlightStyle.specs.find(
      (rule) => rule.tag === tags.heading,
    );
    const link = sourceMarkdownHighlightStyle.specs.find(
      (rule) => Array.isArray(rule.tag) && rule.tag.includes(tags.link),
    );

    expect(heading).toMatchObject({
      color: "var(--editor-heading)",
      fontWeight: "600",
      textDecoration: "none",
    });
    expect(link).toMatchObject({
      color: "var(--editor-link)",
      textDecoration: "underline",
    });
  });
});