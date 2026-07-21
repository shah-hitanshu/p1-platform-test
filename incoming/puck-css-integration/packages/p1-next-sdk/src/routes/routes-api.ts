import { NextResponse } from "next/server";

import {
  listRoutes,
  runWithAuthToken,
} from "@pantheon-systems/puck-css/server";

export async function getRoutes(request: Request): Promise<NextResponse> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return runWithAuthToken(token, async () => {
    const routes = await listRoutes();
    return NextResponse.json({ routes });
  });
}
