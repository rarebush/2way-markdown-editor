import { diffLines } from "diff";

export type EditOrigin = "source" | "rich";

export type RoundTripDifferences = Map<string, number>;

export function getRoundTripDifferences(
  source: string,
  serialized: string,
): RoundTripDifferences | null {
  const differences = new Map<string, number>();
  if (source === serialized) return differences;

  const changes = diffLines(source, serialized, { timeout: 100 });
  if (!changes) return null;

  let removed = "";
  let added = "";
  const record = () => {
    if (!removed && !added) return;
    const key = JSON.stringify([removed, added]);
    differences.set(key, (differences.get(key) ?? 0) + 1);
    removed = "";
    added = "";
  };
  for (const change of changes) {
    if (change.removed) removed += change.value;
    else if (change.added) added += change.value;
    else record();
  }
  record();
  return differences;
}

export function differencesWereApproved(
  differences: RoundTripDifferences,
  approved: RoundTripDifferences,
) {
  return [...differences].every(
    ([difference, count]) => count <= (approved.get(difference) ?? 0),
  );
}

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
