/**
 * P1 Next SDK page handler — provides page components for `/p1/[[...p1]]`.
 *
 * The editor renders from `Layout`, not `Page`: Next.js keys segment cache
 * nodes by their param values, so everything inside `[[...p1]]` — page AND
 * any layout placed there — remounts when the param changes, tearing down
 * the whole editor (providers, auth, Puck and its canvas iframe) on every
 * document switch. `Layout` must therefore be mounted at a static segment,
 * which persists; the editor follows the URL client-side from there (see
 * editor-paths.ts).
 *
 * Mount that layout in an `(editor)` route group rather than directly at
 * `app/p1/layout.tsx`. A layout at `/p1` wraps EVERY route under it, so
 * sibling routes with their own pages (e.g. /p1/merge, /p1/settings) would
 * render the editor on top of themselves. Scoping the layout to the group
 * means only the catch-all page gets the editor; siblings placed outside the
 * group stay editor-free by construction. Route groups add no URL segment, so
 * /p1 and its subpaths are unchanged.
 *
 * Usage:
 *   // app/p1/(editor)/[[...p1]]/p1-pages.tsx (shared module)
 *   import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";
 *   export const pages = createP1Pages({ config, EditorClient });
 *
 *   // app/p1/(editor)/layout.tsx  <- static segment scoped to the group
 *   export default pages.Layout;
 *
 *   // app/p1/(editor)/[[...p1]]/page.tsx
 *   export default pages.Page;
 *   export const generateMetadata = pages.generateMetadata;
 *   export const dynamic = "force-dynamic";
 *
 *   // app/p1/merge/page.tsx        <- sibling OUTSIDE the group, no editor
 *   // app/p1/settings/page.tsx     <- future siblings: same, editor-free
 *
 * The editor must be mounted at `/p1`: the client derives the edited page
 * from the URL via editorPagePathFromUrlPath, whose basePath defaults to
 * "/p1". A different mount point needs that basePath passed through in the
 * EditorClient implementation, or every URL falls back to the root page.
 */

import type { Config } from "@puckeditor/core";
import type { Metadata } from "next";

import {
  ensureInitialized,
  type P1DataConfig,
} from "@pantheon-systems/puck-css/server";

import { parseEditorSegments } from "./editor-paths";

export type P1PagesConfig = P1DataConfig & {
  config: Config;
  /**
   * React component to render the editor. Rendered from the persistent
   * layout with no props — it derives the page path from the URL (see
   * editorPagePathFromUrlPath) and handles its own data loading and auth
   * via P1App.
   */
  EditorClient: React.ComponentType;
};

export function createP1Pages(opts: P1PagesConfig) {
  const { EditorClient } = opts;
  // Called per request, not pinned at module load: ensureInitialized dedupes
  // successful inits and clears its state on failure, so a transient failure at
  // cold start retries instead of leaving every later request awaiting a
  // permanently rejected promise.
  const init = () => ensureInitialized(opts);

  // A parent layout always renders before its child page within a request, so
  // if the editor is mounted correctly Layout flips this before Page reads it.
  // A legacy page-only app (no `(editor)/layout.tsx`) renders Page alone, and
  // the flag is still false — the dev-only nudge below fires. Per-process,
  // best-effort: it can't run in production and never affects output.
  let layoutRendered = false;
  let warnedMissingLayout = false;

  async function generateMetadata({
    params,
  }: {
    params: Promise<{ p1?: string[] }>;
  }): Promise<Metadata> {
    await init();
    const { p1 = [] } = await params;
    const pagePath = parseEditorSegments(p1);
    return { title: "P1 Editor: " + pagePath };
  }

  // Persists across route-param changes — the editor lives here. Sets the flag
  // synchronously (before any await) so Page can observe it in the same request.
  async function Layout({ children }: { children: React.ReactNode }) {
    layoutRendered = true;
    await init();
    return (
      <>
        <EditorClient />
        {children}
      </>
    );
  }

  // Remounts per navigation; must stay empty so nothing is lost when it does.
  function Page() {
    if (
      process.env.NODE_ENV !== "production" &&
      !layoutRendered &&
      !warnedMissingLayout
    ) {
      warnedMissingLayout = true;
      console.warn(
        "[p1-next-sdk] The P1 editor now renders from pages.Layout, but this " +
          "app rendered pages.Page without it — the editor will be empty. Mount " +
          "it at app/p1/(editor)/layout.tsx, or run: " +
          "npx @pantheon-systems/p1-next-sdk p1-migrate — see " +
          "docs/MIGRATION-EDITOR-LAYOUT.md",
      );
    }
    return null;
  }

  return { Page, Layout, generateMetadata };
}
