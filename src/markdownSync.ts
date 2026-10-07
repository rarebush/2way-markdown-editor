export type EditOrigin = "source" | "rich";

export function shouldReplaceRichDocument(
  origin: EditOrigin | undefined,
  sharedMarkdown: string,
  liveMarkdown: string,
) {
  return origin !== "rich" && sharedMarkdown !== liveMarkdown;
}
