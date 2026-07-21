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

export async function postPublish(request: Request) {
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
  }

  return NextResponse.json({ status: "ok" });
}
