import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const componentPath = resolve(
  appDir,
  "components/puck/paragraph-editor-text.tsx",
);
const paragraphPath = resolve(appDir, "components/puck/paragraph-block.tsx");

describe("ParagraphEditorText component", () => {
  it("exists as a separate file", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  it("is a client component", () => {
    const content = readFileSync(componentPath, "utf-8");
    expect(content).toMatch(/^["']use client["']/);
  });

  it("imports useResolvedPreviewState from puck-css", () => {
    const content = readFileSync(componentPath, "utf-8");
    expect(content).toContain("useResolvedPreviewState");
  });

  it("imports getBlockPropsById from puck-css", () => {
    const content = readFileSync(componentPath, "utf-8");
    expect(content).toContain("getBlockPropsById");
  });

  it("extracts raw text from element props to detect template tokens", () => {
    const content = readFileSync(componentPath, "utf-8");
    expect(content).toContain("extractRawText");
    expect(content).toMatch(/\{\{/);
  });

  it("tracks focus state via onFocus, onBlur, and a mousedown document listener for click-outside", () => {
    const content = readFileSync(componentPath, "utf-8");
    expect(content).toContain("onFocus");
    expect(content).toContain("onBlur");
    expect(content).toContain('addEventListener("mousedown"');
  });

  it("uses transparent text and pointer-events overlay instead of hiding the InlineTextField", () => {
    const content = readFileSync(componentPath, "utf-8");
    expect(content).toContain("color: \"transparent\"");
    expect(content).toContain("pointerEvents: \"none\"");
  });

  it("renders resolved text as sanitized HTML, not Markdown", () => {
    const content = readFileSync(componentPath, "utf-8");
    expect(content).toContain("sanitizeRichtextHtml");
    expect(content).toContain("dangerouslySetInnerHTML");
    expect(content).not.toContain("ReactMarkdown");
  });
});

describe("paragraph-block uses ParagraphEditorText", () => {
  const content = readFileSync(paragraphPath, "utf-8");

  it("imports ParagraphEditorText", () => {
    expect(content).toContain("ParagraphEditorText");
  });

  it("destructures id from render props", () => {
    expect(content).toMatch(/\bid\b.*:/);
  });

  it("wraps isValidElement branch with ParagraphEditorText", () => {
    const reactElementBranch = content.slice(
      content.indexOf("isValidElement(text)"),
      content.indexOf("isValidElement(text)") + 200,
    );
    expect(reactElementBranch).toContain("ParagraphEditorText");
  });
});