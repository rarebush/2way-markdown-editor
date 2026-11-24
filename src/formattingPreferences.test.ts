// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultFormattingPreferences,
  loadFormattingPreferences,
  saveFormattingPreferences,
} from "./formattingPreferences";

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("global formatting preferences", () => {
  it("persists explicit settings and uses the existing formatting by default", () => {
    expect(loadFormattingPreferences()).toEqual(defaultFormattingPreferences);
    const preferences = { ...defaultFormattingPreferences, rule: "-" as const };
    saveFormattingPreferences(preferences);
    expect(loadFormattingPreferences()).toEqual(preferences);
  });

  it("reports invalid stored settings instead of silently applying them", () => {
    window.localStorage.setItem("draft-markdown-formatting-preferences", '{"rule":["*"]}');
    expect(() => loadFormattingPreferences()).toThrow();
  });
});
