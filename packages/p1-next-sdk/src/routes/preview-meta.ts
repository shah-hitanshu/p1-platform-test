import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { setPageEditorPreviewParams, normalizePath } from "@pantheon-systems/puck-css/server";

export { postPreviewMeta as POST };

export async function postPreviewMeta(request: Request) {
  let body: { path?: string; previewParams?: Record<string, string> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const previewParams =
    body.previewParams && typeof body.previewParams === "object" && !Array.isArray(body.previewParams)
      ? body.previewParams
      : {};

  const normalized = normalizePath(body.path);
  if (!normalized) {
    return NextResponse.json({ ok: false, error: "Invalid or reserved path" }, { status: 400 });
  }

  setPageEditorPreviewParams(normalized, previewParams);
  revalidatePath(normalized);

  return NextResponse.json({ ok: true, path: normalized });
}
