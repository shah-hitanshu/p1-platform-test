import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..");

describe("p1-next-sdk security hardening", () => {
  it("page-data route uses normalizePath instead of stripTrailingSlash", () => {
    const content = readFileSync(resolve(srcDir, "routes/page-data.ts"), "utf-8");
    expect(content).toContain("normalizePath");
    expect(content).not.toContain("stripTrailingSlash");
  });

  it("publish route validates path before persisting", () => {
    const content = readFileSync(resolve(srcDir, "routes/publish.ts"), "utf-8");
    expect(content).toContain("normalizePath");
    expect(content).toMatch(/400|invalid|bad.?request/i);
  });
});
