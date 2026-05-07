import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  createStaticPage,
  createCollectionTemplate,
  createCollectionOverride,
  deletePageAtPath,
} from "@pantheon-systems/puck-css/server";

type StructureKind = "page" | "template" | "override";

const structureCreators: Record<StructureKind, (path: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>> = {
  page: createStaticPage,
  template: createCollectionTemplate,
  override: createCollectionOverride,
};

export async function postStructure(request: Request, kind: StructureKind) {
  const body = (await request.json()) as { path?: string };
  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path) {
    return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });
  }
  const result = await structureCreators[kind](path);
  if (result.ok === false) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  revalidatePath(result.path);
  revalidatePath("/p1");
  return NextResponse.json({ ok: true, path: result.path });
}

export async function deleteStructurePage(request: Request) {
  let body: { path?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path) {
    return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });
  }
  const result = await deletePageAtPath(path);
  if (result.ok === false) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  for (const p of result.deletedPaths) {
    revalidatePath(p);
  }
  revalidatePath("/p1");
  return NextResponse.json({ ok: true, deletedPaths: result.deletedPaths });
}
