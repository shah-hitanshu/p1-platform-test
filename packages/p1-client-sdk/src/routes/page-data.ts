import { NextResponse } from "next/server";

import { getPage } from "../lib/get-page";
import { stripTrailingSlash } from "../lib/paths";

export async function getPageData(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("path") ?? "/";
  const path = stripTrailingSlash(raw);
  const data = getPage(path);
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ data });
}

export { getPageData as GET };
