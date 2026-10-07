export function configureIosViewport(
  document: Document,
  navigator: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
) {
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return;

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return;

  // iOS Safari suppresses focus zoom with this limit but still permits pinch zoom.
  const directives = viewport.content
    .split(",")
    .map((directive) => directive.trim())
    .filter((directive) => directive && !/^maximum-scale\s*=/i.test(directive));
  viewport.content = [...directives, "maximum-scale=1"].join(", ");
}
