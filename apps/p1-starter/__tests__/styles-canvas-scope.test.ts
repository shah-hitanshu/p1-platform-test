import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");

// Puck's collectStyles() copies every parent
// <style>/<link> element into the canvas-preview iframe verbatim (there is
// no exclusion API), and separately its CopyHostStyles helper syncs this
// document's <body> attributes (including `class`) onto the iframe's own
// <body>. That means a bare `body {...}` rule — or even a `body.some-class
// {...}` rule scoped to a class placed directly on <body> — still matches
// inside the canvas iframe and can override the canvas's own
// design-token-based body styling (as happened with a hardcoded
// `color: #111; background: #fff;` on the Teamworks dev site).
//
// The only reset that stays out of the iframe is one keyed off a *child* of
// <body> that Puck's canvas never renders (the iframe only ever portals the
// Puck root/block tree into its own #frame-root — never this layout).
describe("app/styles.css keeps body-level resets out of Puck's canvas iframe", () => {
  const rawCss = readFileSync(resolve(appDir, "app/styles.css"), "utf-8");
  // Strip comments so example selectors mentioned in explanatory comments
  // don't trip the regexes below.
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const layout = readFileSync(resolve(appDir, "app/layout.tsx"), "utf-8");

  it("does not define a bare, unscoped `body { ... }` rule", () => {
    // Matches a `body` selector not immediately followed by a combinator/
    // pseudo-class condition (i.e. a plain element selector with no scoping).
    const bareBodySelector = /(^|[^.\w:-])body\s*\{/m;
    expect(bareBodySelector.test(css)).toBe(false);
  });

  it("does not scope the reset to a class/attribute placed directly on body", () => {
    // e.g. `body.foo {...}` or `body[data-foo] {...}` — these get defeated
    // by Puck's CopyHostStyles, which syncs body's own attributes into the
    // iframe's body too.
    expect(css).not.toMatch(/body(\.[\w-]+|\[[^\]]+\])\s*\{/);
  });

  it("scopes the margin reset via :has() of a child element", () => {
    expect(css).toMatch(/body:has\(\s*>?\s*\.p1-app-shell\s*\)\s*\{[^}]*margin:\s*0/);
  });

  it("wraps the real app tree in .p1-app-shell, as a child of <body>", () => {
    expect(layout).toMatch(/<body[^>]*>[\s\S]*<div className="p1-app-shell">/);
  });
});
