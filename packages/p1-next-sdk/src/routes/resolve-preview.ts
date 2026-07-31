import type { Data } from "@puckeditor/core";
import { NextResponse } from "next/server";

import type { RemoteDatasourceContext } from "@pantheon-systems/puck-css/server";
import { resolveDataTemplates } from "@pantheon-systems/puck-css/server";

export { postResolvePreview as POST };

export async function postResolvePreview(request: Request) {
  let body: { data?: Partial<Data>; remoteDatasourceContext?: RemoteDatasourceContext; datasourceContext?: RemoteDatasourceContext };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const data = body.data ?? {};
  const datasourceContext = body.remoteDatasourceContext ?? body.datasourceContext ?? {};

  const resolved = await resolveDataTemplates(data as Partial<Data>, datasourceContext);
  return NextResponse.json({ data: resolved });
}
