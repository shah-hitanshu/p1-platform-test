import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const content = readFileSync(
  resolve(appDir, "components/puck/paragraph-block.tsx"),
  "utf-8",
);

describe("paragraphBlock", () => {
  it("uses richtextField for the text field", () => {
    expect(content).toContain("richtextField");
    expect(content).toMatch(/text:\s*richtextField/);
  });

  it("exports paragraphBlock with defaultProps", () => {
    expect(content).toContain("export const paragraphBlock");
    expect(content).toContain("defaultProps");
  });

  it("provides a render function", () => {
    expect(content).toMatch(/render:\s*\(/);
  });

  it("wraps editor text in ParagraphEditorText for template preview", () => {
    expect(content).toContain("ParagraphEditorText");
  });

  it("sanitizes richtext HTML for published rendering", () => {
    expect(content).toContain("sanitizeRichtextHtml");
  });

  it("has a default text prop", () => {
    expect(content).toMatch(/text:\s*["']/);
  });
});
