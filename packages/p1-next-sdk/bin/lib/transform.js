/**
 * Pure string transforms for the p1-migrate codemod.
 *
 * No filesystem, no side effects — every function takes source in and returns
 * source out (or throws BailError when the input isn't the shape we recognize).
 * The moves and depth rule are mechanical; the two localized edits validate
 * their target and bail rather than guess, so a diverged app is never left
 * half-migrated.
 */

export class BailError extends Error {
  constructor(message) {
    super(message);
    this.name = "BailError";
  }
}

/**
 * Moving a file one directory deeper (into the `(editor)` group) adds a real
 * on-disk segment the URL never sees, so every relative import that already
 * points at a parent gains one more `../`. Sibling (`./`) and bare package
 * specifiers are untouched.
 */
export function deepenRelativeImports(source) {
  return source.replace(
    /(\bfrom\s+|\bimport\s+|\bimport\(\s*|\brequire\(\s*)(['"])(\.\.\/)/g,
    (_match, prefix, quote, dots) => `${prefix}${quote}../${dots}`,
  );
}

/**
 * Add `name` to the named-import list for `moduleSpecifier`. Idempotent when
 * the name is already imported; bails when the module isn't imported at all.
 */
export function addNamedImport(source, moduleSpecifier, name, position = "append") {
  const escaped = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(import\\s*\\{)([^}]*)(\\}\\s*from\\s*['"])${escaped}(['"])`);
  const match = source.match(re);
  if (!match) {
    throw new BailError(
      `Expected an import from "${moduleSpecifier}" to add "${name}" to; migrate this file by hand.`,
    );
  }
  const names = match[2].split(",").map((s) => s.trim()).filter(Boolean);
  if (names.includes(name)) return source;
  const next = position === "prepend" ? [name, ...names] : [...names, name];
  return source.replace(re, `$1 ${next.join(", ")} $3${moduleSpecifier}$4`);
}

const LEGACY_SIGNATURE =
  /export function EditorClientWrapper\(\{\s*path\s*\}\s*:\s*\{\s*path\s*:\s*string\s*\}\s*\)\s*\{/;
const MIGRATED_SIGNATURE = /export function EditorClientWrapper\(\s*\)/;

/**
 * Drop the `{ path }` prop from EditorClientWrapper and derive the path from
 * the URL instead — matching how the persistent layout renders it with no props.
 */
export function rewriteWrapperSignature(source) {
  if (LEGACY_SIGNATURE.test(source)) {
    return source.replace(
      LEGACY_SIGNATURE,
      "export function EditorClientWrapper() {\n" +
        "  // Rendered from the persistent (editor) layout, so this survives page\n" +
        "  // switches; the edited page is derived from the URL instead of route params.\n" +
        "  const pathname = usePathname();\n" +
        "  const path = editorPagePathFromUrlPath(pathname);",
    );
  }
  if (MIGRATED_SIGNATURE.test(source)) return source;
  throw new BailError(
    "EditorClientWrapper has an unrecognized signature; migrate this file by hand.",
  );
}

/** Full editor-client transform: deepen imports, add the two named imports, rewrite the signature. */
export function rewriteEditorClient(source) {
  let out = deepenRelativeImports(source);
  out = addNamedImport(out, "next/navigation", "usePathname", "prepend");
  out = addNamedImport(out, "@pantheon-systems/p1-next-sdk", "editorPagePathFromUrlPath", "append");
  out = rewriteWrapperSignature(out);
  return out;
}

/** The thin page.tsx that re-exports from the shared p1-pages module. */
export function buildNewPageFile() {
  return (
    'import { pages } from "./p1-pages";\n' +
    "\n" +
    "export default pages.Page;\n" +
    "export const generateMetadata = pages.generateMetadata;\n" +
    'export const dynamic = "force-dynamic";\n'
  );
}

/** The `(editor)/layout.tsx` that renders the persistent editor. */
export function buildLayoutFile() {
  return (
    'import "@puckeditor/core/puck.css";\n' +
    'import { pages } from "./[[...p1]]/p1-pages";\n' +
    "\n" +
    "// The editor renders from this layout, NOT the page. The (editor) group is a\n" +
    "// static segment, so this layout survives navigation between /p1/<pageA> and\n" +
    "// /p1/<pageB> — a layout inside [[...p1]] would remount on every switch, since\n" +
    "// Next keys segment cache nodes by param value.\n" +
    "//\n" +
    "// Scoping the layout to the (editor) group (instead of app/p1/layout.tsx) is\n" +
    "// what keeps the editor off sibling routes: /p1/merge and future pages like\n" +
    "// /p1/settings live outside the group and never render the editor. Add such\n" +
    "// pages as siblings of (editor), not inside it.\n" +
    "export default pages.Layout;\n"
  );
}

/** The re-exports that belong to the route file, not the shared factory module. */
const PAGE_LEVEL_EXPORTS = [
  /^export default pages\.Page;\n/m,
  /^export const generateMetadata = pages\.generateMetadata;\n/m,
  /^export const dynamic = ["']force-dynamic["'];\n/m,
];

/**
 * Split the old catch-all page.tsx into the shared factory module (p1-pages.tsx)
 * and the thin re-export page.tsx. Bails when the file isn't the recognized
 * createP1Pages editor page.
 */
export function splitPageFile(source) {
  if (!source.includes("createP1Pages(") || !source.includes("pages.Page")) {
    throw new BailError(
      "page.tsx is not the recognized createP1Pages editor page; migrate it by hand.",
    );
  }
  let p1Pages = deepenRelativeImports(source);
  // The puck.css side-effect moves to layout.tsx.
  p1Pages = p1Pages.replace(/^import ["']@puckeditor\/core\/puck\.css["'];\n/m, "");

  // Export the factory result so both layout.tsx and page.tsx can consume it.
  p1Pages = p1Pages.replace(/\bconst pages = createP1Pages\(/, "export const pages = createP1Pages(");
  if (!/\bexport const pages = createP1Pages\(/.test(p1Pages)) {
    throw new BailError(
      "Could not find `const pages = createP1Pages(` to export from page.tsx; migrate this file by hand.",
    );
  }

  // The page-level re-exports move to the thin page.tsx. Stripped individually
  // so a reordered file does not leave dead exports behind in p1-pages.tsx.
  for (const re of PAGE_LEVEL_EXPORTS) p1Pages = p1Pages.replace(re, "");
  p1Pages = p1Pages.replace(/\n+$/, "\n");
  if (/^export default pages\.Page;$/m.test(p1Pages)) {
    throw new BailError(
      "Could not remove the page-level exports from page.tsx; migrate this file by hand.",
    );
  }

  return { p1Pages, page: buildNewPageFile() };
}
