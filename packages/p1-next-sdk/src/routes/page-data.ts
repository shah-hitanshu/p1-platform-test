import { NextResponse } from "next/server";

import { getPage, normalizePath } from "@pantheon-systems/puck-css/server";

export async function getPageData(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("path") ?? "/";
  const path = raw === "/" ? "/" : normalizePath(raw);
  if (path === null) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }
  const data = await getPage(path);
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ data });
}

export { getPageData as GET };
