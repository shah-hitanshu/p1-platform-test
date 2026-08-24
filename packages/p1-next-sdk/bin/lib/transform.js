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

/**
 * The editor's mid-switch waiting state moved into the SDK: `useP1Editor` now
 * retains the last rendered props itself and reports *why* it is reloading, and
 * `<EditorReloadOverlay>` owns the copy for each wait. The old inline version
 * could not tell a workstream switch from a page switch, so it announced every
 * reload as "Switching workstream".
 */
const OVERLAY_EDITS = [
  [
    `  const [userRole, setUserRole] = useState<ContentRole>('editor');\n` +
      `  const lastGoodStateRef = React.useRef<{ puckKey: string; puckProps: any } | null>(null);\n`,
    `  const [userRole, setUserRole] = useState<ContentRole>('editor');\n`,
  ],
  [
    `<EditorContent path={path} lastGoodStateRef={lastGoodStateRef} />`,
    `<EditorContent path={path} />`,
  ],
  [
    `function EditorContent({\n` +
      `  path,\n` +
      `  lastGoodStateRef,\n` +
      `}: {\n` +
      `  path: string;\n` +
      `  lastGoodStateRef: React.MutableRefObject<{ puckKey: string; puckProps: any } | null>;\n` +
      `}) {`,
    `function EditorContent({ path }: { path: string }) {`,
  ],
  [
    `  const { loading, error, puckKey, puckProps } = useP1Editor({`,
    `  const { loading, reloading, hasContent, error, puckKey, puckProps } = useP1Editor({`,
  ],
  [
    `  P1QueryProvider,\n  editorPathHref,\n} from "@pantheon-systems/puck-css";`,
    `  P1QueryProvider,\n  editorPathHref,\n  EditorReloadOverlay,\n} from "@pantheon-systems/puck-css";`,
  ],
  [
    `  // Update last good state when loading completes successfully (ref passed from parent)
  React.useEffect(() => {
    if (!loading && !error) {
      lastGoodStateRef.current = { puckKey, puckProps };
    }
  }, [loading, error, puckKey, puckProps]);

  if (redirecting) {
    return <LoadingMessage message="Redirecting" data-testid="editor-redirecting" />;
  }

  // Show full loading screen only on first load (no previous state)
  if (loading && !lastGoodStateRef.current) {
    return <LoadingMessage message="Loading document" data-testid="editor-loading" />;
  }

  // Show error only if we have no previous state to fall back to
  if (error && !lastGoodStateRef.current) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        <h3>Error loading document</h3>
        <p style={{ color: "#666" }}>{error.message}</p>
      </div>
    );
  }

  // Use current state if loaded, otherwise keep showing last good state
  const displayState = (!loading && !error)
    ? { puckKey, puckProps }
    : lastGoodStateRef.current ?? { puckKey, puckProps };

  return (
    <div className="puck-editor-theme" style={{ position: "relative" }}>
      {/* Loading overlay - shown during branch switch */}
      {loading && lastGoodStateRef.current && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 9999,
            background: "rgba(255, 255, 255, 0.95)",
            padding: "1rem 2rem",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
            fontFamily: "system-ui",
            fontSize: "14px",
            color: "#333",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              width: "16px",
              height: "16px",
              border: "2px solid #e0e0e0",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              animation: "spin 0.6s linear infinite",
            }}
          />
          Switching workstream...
          <style>{\`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          \`}</style>
        </div>
      )}
      <DatasourceRegistryProvider registry={editorCtx?.remoteDatasourceRegistry ?? []}>
        <DatasourceDataProvider context={remoteDatasourceContext}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Puck key={\`\${displayState.puckKey}-\${chatbotEnabled ? "ai" : "no-ai"}\`} {...displayState.puckProps as any} _experimentalFullScreenCanvas={true} />
        </DatasourceDataProvider>
      </DatasourceRegistryProvider>
    </div>
  );
}
`,
    `  if (redirecting) {
    return <LoadingMessage message="Redirecting" data-testid="editor-redirecting" />;
  }

  if (loading) {
    return <LoadingMessage message="Loading document" data-testid="editor-loading" />;
  }

  // A failed load with a document already on screen keeps that document; only a
  // failure with nothing to fall back on takes over the view.
  if (error && !hasContent) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        <h3>Error loading document</h3>
        <p style={{ color: "#666" }}>{error.message}</p>
      </div>
    );
  }

  return (
    <div className="puck-editor-theme" style={{ position: "relative" }}>
      <EditorReloadOverlay reloading={reloading} />
      <DatasourceRegistryProvider registry={editorCtx?.remoteDatasourceRegistry ?? []}>
        <DatasourceDataProvider context={remoteDatasourceContext}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Puck key={\`\${puckKey}-\${chatbotEnabled ? "ai" : "no-ai"}\`} {...puckProps as any} _experimentalFullScreenCanvas={true} />
        </DatasourceDataProvider>
      </DatasourceRegistryProvider>
    </div>
  );
}
`,
  ],
];

/**
 * Swap the hand-rolled loading overlay for the SDK one. Every anchor has to
 * match: an app already on the SDK overlay is left alone, and an app that
 * edited part of this region keeps its own version rather than being left with
 * a broken mix of the two.
 */
export function rewriteLoadingOverlay(source) {
  const found = OVERLAY_EDITS.filter(([find]) => source.includes(find));
  if (found.length === 0) return source;
  if (found.length !== OVERLAY_EDITS.length) {
    throw new BailError(
      "editor-client.tsx has a partly-customized loading overlay; migrate this file by hand.",
    );
  }
  let out = source;
  for (const [find, replace] of OVERLAY_EDITS) out = out.replace(find, replace);
  return out;
}

/** Full editor-client transform: deepen imports, add the named imports, rewrite the signature, adopt the SDK overlay. */
export function rewriteEditorClient(source) {
  let out = deepenRelativeImports(source);
  out = addNamedImport(out, "next/navigation", "usePathname", "prepend");
  out = addNamedImport(out, "@pantheon-systems/p1-next-sdk", "editorPagePathFromUrlPath", "append");
  out = rewriteWrapperSignature(out);
  out = rewriteLoadingOverlay(out);
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
