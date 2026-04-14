import type { Data } from "@puckeditor/core";
import { NextResponse } from "next/server";

import type { RemoteDatasourceContext } from "../lib/remote-datasources/loader";
import { resolveDataTemplates } from "../lib/resolve-data-templates";

export { postResolvePreview as POST };

export async function postResolvePreview(request: Request) {
  let body: { data?: Partial<Data>; datasourceContext?: RemoteDatasourceContext };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const data = body.data ?? {};
  const datasourceContext = body.datasourceContext ?? {};

  const resolved = resolveDataTemplates(data as Partial<Data>, datasourceContext);
  return NextResponse.json({ data: resolved });
}
