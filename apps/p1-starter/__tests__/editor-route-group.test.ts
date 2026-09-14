/**
 * The persistent editor is scoped to the `(editor)` route group so it wraps
 * only the catch-all editor page — not sibling routes under /p1 such as a
 * future /p1/settings. This structure replaces the old NON_EDITOR_ROUTES
 * opt-out list: siblings stay editor-free by construction, not by enumeration.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const p1 = resolve(appDir, "app/p1");

describe("editor is scoped to the (editor) route group", () => {
  it("mounts the persistent editor layout inside the group", () => {
    const layout = resolve(p1, "(editor)/layout.tsx");
    expect(existsSync(layout)).toBe(true);
    expect(readFileSync(layout, "utf-8")).toContain("pages.Layout");
  });

  it("keeps the catch-all editor page inside the group", () => {
    expect(existsSync(resolve(p1, "(editor)/[[...p1]]/page.tsx"))).toBe(true);
    expect(existsSync(resolve(p1, "(editor)/[[...p1]]/editor-client.tsx"))).toBe(true);
  });

  it("does not mount a layout at /p1 that would wrap every sibling", () => {
    expect(existsSync(resolve(p1, "layout.tsx"))).toBe(false);
  });

  it("holds nothing but the catch-all inside the group, so siblings stay editor-free", () => {
    const inGroup = readdirSync(resolve(p1, "(editor)"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(inGroup).toEqual(["[[...p1]]"]);
  });

  it("no longer guards routes with a NON_EDITOR_ROUTES opt-out list", () => {
    const editorClient = readFileSync(
      resolve(p1, "(editor)/[[...p1]]/editor-client.tsx"),
      "utf-8",
    );
    expect(editorClient).not.toContain("NON_EDITOR_ROUTES");
  });
});
