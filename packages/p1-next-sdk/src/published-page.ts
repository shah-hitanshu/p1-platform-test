/**
 * Server-side readers for published content.
 *
 * These live in the SDK rather than the scaffolded app because they carry the
 * invariants that keep public routes cacheable and correct: initialization is
 * awaited per read so a failed cold start can recover, a miss is reported
 * distinctly from an outage so it can become a real 404 instead of a cached
 * 200, and prerendering is aborted rather than baking an empty page into the
 * build. A renderer that gets any of those wrong fails in ways that only show
 * up under CDN caching or a backend blip.
 *
 * How a miss is presented — the copy, the styling, the editor links — is the
 * app's business, and stays in the app.
 */

import { cache } from "react";
import { connection } from "next/server";
import {
  ensureInitialized,
  getPage,
  listRouteTemplateKeysFromDatabase,
} from "@pantheon-systems/puck-css/server";
import type { Data } from "@puckeditor/core";

/**
 * Outcome of a published-page read.
 *
 * `missing` and `unavailable` are deliberately separate. A miss is a real 404 —
 * the caller should say so, so crawler traffic is not cached as a wall of
 * 200-status "doesn't exist yet" pages. An outage is not: 404ing a published
 * page because the backend blipped would deindex live content, so the caller
 * should keep serving a non-cacheable holding page instead.
 */
export type PublishedPageResult =
  | { status: "ok"; data: Data }
  | { status: "missing" }
  | { status: "unavailable" };

/**
 * Awaited on every read rather than pinned to a module-level promise: the DAL
 * dedupes successful inits itself and clears its state on failure, so calling it
 * per read is what lets a transient cold-start failure recover instead of
 * serving the empty state until the process restarts.
 */
const initP1 = () =>
  ensureInitialized({
    p1BaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL,
    p1ApiKey: process.env.CSS_API_KEY,
    p1SiteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
    // Default to "main" when unset: server components (no user token) need a
    // branch to list/read documents (e.g. the /structure routes table).
    p1BranchId: process.env.NEXT_PUBLIC_CSS_BRANCH_ID ?? "main",
  });

async function unavailable(
  path: string,
  error: unknown,
): Promise<PublishedPageResult> {
  console.warn(
    `[p1-next-sdk] published content unavailable for ${path}:`,
    error instanceof Error ? error.message : String(error),
  );
  // Aborts prerendering and defers to the request. Public pages are prerendered
  // at build time now that they no longer opt out of caching, so without this a
  // build running while the backend is down would fail outright, and a build
  // against a half-up backend would bake the holding page into cached output.
  await connection();
  return { status: "unavailable" };
}

/**
 * Published Puck data for `path`.
 *
 * Memoized with cache(): generateMetadata and the page body both need the same
 * page, and without this every render reads it from the backend twice.
 */
export const loadPublishedPage = cache(
  async (path: string): Promise<PublishedPageResult> => {
    try {
      await initP1();
      const data = await getPage(path);
      return data ? { status: "ok", data } : { status: "missing" };
    } catch (error) {
      return unavailable(path, error);
    }
  },
);

/**
 * Collection template keys for the current render.
 *
 * Memoized with cache(): metadata resolution and the page body each need them,
 * and each call lists every key in the store.
 */
export const loadRouteTemplateKeys = cache(async (): Promise<string[]> => {
  await initP1();
  return listRouteTemplateKeysFromDatabase();
});
