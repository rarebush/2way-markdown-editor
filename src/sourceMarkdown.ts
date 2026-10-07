import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";

export const sourceMarkdownLanguage = markdown({ extensions: [GFM] });

export const sourceMarkdownHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading,
    color: "var(--editor-heading)",
    fontWeight: "600",
    textDecoration: "none",
  },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: [tags.link, tags.url],
    color: "var(--editor-link)",
    textDecoration: "underline",
  },
  {
    tag: tags.monospace,
    color: "var(--editor-text)",
    backgroundColor: "var(--editor-code-background)",
  },
  {
    tag: [tags.quote, tags.list, tags.contentSeparator, tags.meta],
    color: "var(--editor-muted)",
  },
]);

export const sourceMarkdownExtensions = [
  sourceMarkdownLanguage,
  syntaxHighlighting(sourceMarkdownHighlightStyle),
];
