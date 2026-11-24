export type FormattingPreferences = {
  rule: "*" | "-" | "_";
  bullet: "*" | "-" | "+";
  emphasis: "preserve" | "*" | "_";
  headings: "atx" | "setext";
};

export const defaultFormattingPreferences: FormattingPreferences = {
  rule: "*",
  bullet: "*",
  emphasis: "preserve",
  headings: "atx",
};

export function isFormattingPreferences(
  value: unknown,
): value is FormattingPreferences {
  if (!value || typeof value !== "object") return false;
  const preferences = value as Record<string, unknown>;
  return (
    ["*", "-", "_"].some((option) => option === preferences.rule) &&
    ["*", "-", "+"].some((option) => option === preferences.bullet) &&
    ["preserve", "*", "_"].some((option) => option === preferences.emphasis) &&
    ["atx", "setext"].some((option) => option === preferences.headings)
  );
}

const storageKey = "draft-markdown-formatting-preferences";

export function loadFormattingPreferences(): FormattingPreferences {
  const stored = window.localStorage.getItem(storageKey);
  if (stored === null) return defaultFormattingPreferences;
  const parsed: unknown = JSON.parse(stored);
  if (!isFormattingPreferences(parsed))
    throw new Error("Stored formatting preferences are invalid.");
  return parsed;
}

export function saveFormattingPreferences(preferences: FormattingPreferences) {
  window.localStorage.setItem(storageKey, JSON.stringify(preferences));
}
