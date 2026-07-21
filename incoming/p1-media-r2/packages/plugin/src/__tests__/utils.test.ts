import { describe, it, expect } from "vitest";
import { buildImageUrl } from "../utils";

const BASE = "https://cdn.staging.pantheon.io/p1/site1/media/123-photo.jpg";

describe("buildImageUrl", () => {
  it("appends transform params as query string", () => {
    const result = buildImageUrl(BASE, { width: 1200, height: 630, format: "webp" });
    const url = new URL(result);
    expect(url.searchParams.get("width")).toBe("1200");
    expect(url.searchParams.get("height")).toBe("630");
    expect(url.searchParams.get("format")).toBe("webp");
  });

  it("preserves existing params (e.g. smart=true set by editor)", () => {
    const withSmart = `${BASE}?smart=true`;
    const result = buildImageUrl(withSmart, { width: 800, format: "webp" });
    const url = new URL(result);
    expect(url.searchParams.get("smart")).toBe("true");
    expect(url.searchParams.get("width")).toBe("800");
    expect(url.searchParams.get("format")).toBe("webp");
  });

  it("skips undefined params", () => {
    const result = buildImageUrl(BASE, { width: 400, format: undefined });
    const url = new URL(result);
    expect(url.searchParams.get("width")).toBe("400");
    expect(url.searchParams.has("format")).toBe(false);
  });

  it("returns the original url unchanged when params are empty", () => {
    const result = buildImageUrl(BASE, {});
    expect(result).toBe(BASE);
  });

  it("returns empty string unchanged", () => {
    expect(buildImageUrl("", { width: 100 })).toBe("");
  });

  it("returns url unchanged when scheme is not http or https", () => {
    const bad = "javascript:alert(1)";
    expect(buildImageUrl(bad, { width: 100 })).toBe(bad);
  });

  it("overwrites an existing param when same key is passed", () => {
    const url = buildImageUrl(BASE, { width: 800 });
    const result = buildImageUrl(url, { width: 1200 });
    expect(new URL(result).searchParams.get("width")).toBe("1200");
  });
});
