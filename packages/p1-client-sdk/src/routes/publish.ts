import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import type { Data } from "@puckeditor/core";

import { isRouteTemplatePath } from "../lib/route-templates";
import {
  listOverridePathsForBase,
  persistPublishedPage,
} from "../lib/page-store";

export { postPublish as POST };

export async function postPublish(request: Request) {
  const payload = (await request.json()) as { path: string; data: Data };

  persistPublishedPage(payload.path, payload.data);
  revalidatePath(payload.path);

  if (isRouteTemplatePath(payload.path)) {
    for (const p of listOverridePathsForBase(payload.path)) {
      revalidatePath(p);
    }
  }

  return NextResponse.json({ status: "ok" });
}
