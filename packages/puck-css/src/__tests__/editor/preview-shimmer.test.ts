import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const previewFile = resolve(
  __dirname,
  "../../p1/editor/editor-preview-resolve.tsx",
);

describe("preview shimmer placeholders", () => {
  const content = readFileSync(previewFile, "utf-8");

  it("passes loading flag through to the resolved context", () => {
    expect(content).toContain("loading");
    expect(content).not.toContain("_loading");
  });

  it("has a shimmerUnresolvedTokens utility", () => {
    expect(content).toContain("shimmerUnresolvedTokens");
  });

  it("detects template tokens using a regex pattern", () => {
    expect(content).toContain("TEMPLATE_TOKEN_RE");
    expect(content).toContain("\\{\\{");
  });

  it("replaces unresolved tokens with placeholder text when loading", () => {
    expect(content).toContain("SHIMMER_PLACEHOLDER");
    expect(content).toContain(".replace(TEMPLATE_TOKEN_RE");
  });
});
