import { NextResponse } from "next/server";
import type { Data } from "@puckeditor/core";

import { normalizePath, persistPublishedPage } from "@pantheon-systems/puck-css/server";

import { DEFAULT_PUBLIC_PAGE_SEGMENT, revalidatePublishedPath } from "./revalidate";

export { postPublish as POST };
export { DEFAULT_PUBLIC_PAGE_SEGMENT };

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
  await revalidatePublishedPath(path, publicPageSegment);

  return NextResponse.json({ status: "ok" });
}
