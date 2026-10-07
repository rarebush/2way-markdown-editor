export type EditOrigin = "source" | "rich";

export function shouldReplaceRichDocument(
  origin: EditOrigin | undefined,
  sharedMarkdown: string,
  liveMarkdown: string,
) {
  return origin !== "rich" && sharedMarkdown !== liveMarkdown;
}

export function isProgrammaticRichEcho(
  emittedMarkdown: string,
  expectedMarkdown: string | null,
) {
  return expectedMarkdown !== null && emittedMarkdown === expectedMarkdown;
}
