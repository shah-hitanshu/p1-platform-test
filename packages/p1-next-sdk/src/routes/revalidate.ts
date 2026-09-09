/**
 * Route invalidation for content published outside Next.js.
 *
 * The editor publishes through the P1 backend, not through this app, so nothing
 * in the request path tells Next.js that a route's content changed. The public
 * page segment is statically renderable (see create-published-page.tsx), which
 * means a render is cached and served again — including the `notFound()` render
 * cached at a path whose page did not exist yet. Publishing that page then left
 * the cached 404 in place for the whole revalidate window, and any CDN in front
 * of the app was told it could keep serving it while revalidating.
 *
 * So the editor calls this after a successful publish. It only invalidates —
 * the content itself is already in the backend, and re-persisting it here would
 * give the same page two write paths.
 */

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  isRouteTemplatePath,
  normalizePath,
  listOverridePathsForBase,
} from "@pantheon-systems/puck-css/server";

export { postRevalidate as POST };

/**
 * Dynamic segment rendering public pages, as Next.js names it for
 * revalidatePath. Overridable for an app whose catch-all directory is not
 * `[...puckPath]`.
 */
export const DEFAULT_PUBLIC_PAGE_SEGMENT = "/[...puckPath]";

/**
 * Invalidate every cached route the content at `path` can be served through.
 *
 * Shared with the publish route so the two cannot drift: a publish that
 * persists through this app and one that reaches the backend directly have to
 * invalidate the same set, or one of them serves stale pages.
 */
export async function revalidatePublishedPath(
  path: string,
  publicPageSegment: string = DEFAULT_PUBLIC_PAGE_SEGMENT,
): Promise<void> {
  revalidatePath(path);

  if (!isRouteTemplatePath(path)) return;

  for (const p of await listOverridePathsForBase(path)) {
    revalidatePath(p);
  }
  // Instance URLs that resolve by template fall-through alone (/jedi/5 against
  // /jedi/:id) have no store entry, so listOverridePathsForBase cannot
  // enumerate them. Invalidating the catch-all segment is the only way to
  // reach them; without it they serve pre-edit content until revalidate
  // expires.
  revalidatePath(publicPageSegment, "page");
}

export async function postRevalidate(
  request: Request,
  { publicPageSegment = DEFAULT_PUBLIC_PAGE_SEGMENT }: { publicPageSegment?: string } = {},
) {
  const payload = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const raw = typeof payload?.path === "string" ? payload.path : null;
  if (raw === null) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const path = raw === "/" ? "/" : normalizePath(raw);
  if (path === null) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  await revalidatePublishedPath(path, publicPageSegment);

  return NextResponse.json({ status: "ok" });
}
