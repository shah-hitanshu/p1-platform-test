import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import type { Data } from "@puckeditor/core";

import {
  isRouteTemplatePath,
  normalizePath,
  listOverridePathsForBase,
  persistPublishedPage,
} from "@pantheon-systems/puck-css/server";

export { postPublish as POST };

/**
 * Dynamic segment rendering public pages, as Next.js names it for
 * revalidatePath. Overridable for an app whose catch-all directory is not
 * `[...puckPath]`.
 */
export const DEFAULT_PUBLIC_PAGE_SEGMENT = "/[...puckPath]";

export async function postPublish(
  request: Request,
  { publicPageSegment = DEFAULT_PUBLIC_PAGE_SEGMENT }: { publicPageSegment?: string } = {},
) {
  const payload = (await request.json()) as { path: string; data: Data };

  const path = payload.path === "/" ? "/" : normalizePath(payload.path);
  if (path === null) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  await persistPublishedPage(path, payload.data);
  revalidatePath(path);

  if (isRouteTemplatePath(path)) {
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

  return NextResponse.json({ status: "ok" });
}
