import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { configureIosViewport } from "./viewport";

const initialContent = "width=device-width, initial-scale=1.0";

function setup(content = initialContent) {
  const browser = new JSDOM('<meta name="viewport">');
  const viewport = browser.window.document.querySelector("meta")!;
  viewport.content = content;
  return { document: browser.window.document, viewport };
}

describe("iOS viewport adjustment", () => {
  it.each(["iPhone", "iPad", "iPod"])("limits focus zoom on %s", (device) => {
    const { document, viewport } = setup();
    configureIosViewport(document, {
      userAgent: `Mozilla/5.0 (${device}) AppleWebKit/605.1.15 Version/18.0 Safari/604.1`,
      platform: device,
      maxTouchPoints: 1,
    });
    expect(viewport.content).toBe(`${initialContent}, maximum-scale=1`);
    expect(viewport.content).not.toContain("user-scalable");
  });

  it("recognizes iPadOS using a desktop user agent", () => {
    const { document, viewport } = setup();
    configureIosViewport(document, {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    });
    expect(viewport.content).toBe(`${initialContent}, maximum-scale=1`);
  });

  it.each([
    { userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 },
    { userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/130.0", platform: "Linux armv8l", maxTouchPoints: 5 },
    { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", platform: "Win32", maxTouchPoints: 10 },
  ])("leaves non-iOS viewport settings unchanged: $platform", (navigator) => {
    const { document, viewport } = setup();
    configureIosViewport(document, navigator);
    expect(viewport.content).toBe(initialContent);
  });

  it("preserves other directives and replaces the limit idempotently", () => {
    const { document, viewport } = setup(`${initialContent}, maximum-scale=5, viewport-fit=cover`);
    const navigator = { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 1 };
    configureIosViewport(document, navigator);
    configureIosViewport(document, navigator);
    expect(viewport.content).toBe(`${initialContent}, viewport-fit=cover, maximum-scale=1`);
  });

  it("handles a missing viewport tag", () => {
    const { document, viewport } = setup();
    viewport.remove();
    expect(() => configureIosViewport(document, {
      userAgent: "iPhone",
      platform: "iPhone",
      maxTouchPoints: 1,
    })).not.toThrow();
  });
});
