/**
 * This stylesheet used to point an `@source` directive at puck-css's dist so
 * Tailwind would generate the utilities that package's own components relied
 * on. That made Tailwind mandatory for every consumer: removing it broke UI
 * inside the package. puck-css now styles itself, so the directive is gone and
 * Tailwind is only a default for the block layer in this project.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(appDir, "app/styles.css"), "utf-8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("app/styles.css does not extend Tailwind's scan into node_modules", () => {
  it("declares no @source directive at all", () => {
    expect(css).not.toMatch(/@source\b/);
  });

  it("still imports Tailwind for this project's own blocks", () => {
    expect(css).toMatch(/@import\s+"tailwindcss"/);
  });
});
