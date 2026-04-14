/**
 * P1 Client SDK handler — NextAuth-style catch-all for `/p1/api/[...p1]`.
 *
 * Usage in your Next.js app:
 *
 *   // app/p1/api/[...p1]/route.ts
 *   import { createP1Handler } from "@pantheon-systems/p1-client-sdk/server";
 *   import config from "../../../../puck.config";
 *   const handler = createP1Handler({ config });
 *   export const { GET, POST, DELETE } = handler;
 */

import type { Config } from "@puckeditor/core";
import { NextResponse } from "next/server";

import {
  getPageData,
  getRemoteDatasources,
  postPublish,
  postResolvePreview,
  postPreviewMeta,
  postRemoteDatasources,
  postAuthDeviceCode,
  postAuthToken,
  postStructure,
  deleteRemoteDatasources,
  deleteStructurePage,
} from "./handler-actions";

/** Extract the sub-path segments from the catch-all `p1` param under `/p1/api/`. */
function parseP1Segments(p1: string[]): { action: string; rest: string[] } {
  if (p1.length === 0) return { action: "", rest: [] };
  const [first, ...rest] = p1;
  return { action: first, rest };
}

export type P1HandlerConfig = {
  config: Config;
};

export function createP1Handler(_opts: P1HandlerConfig) {
  async function GET(
    request: Request,
    { params }: { params: Promise<{ p1?: string[] }> },
  ) {
    const { p1 = [] } = await params;
    const { action } = parseP1Segments(p1);

    if (action === "page-data") return getPageData(request);
    if (action === "datasources") return getRemoteDatasources(request);

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  async function POST(
    request: Request,
    { params }: { params: Promise<{ p1?: string[] }> },
  ) {
    const { p1 = [] } = await params;
    const { action, rest } = parseP1Segments(p1);

    if (action === "publish") return postPublish(request);
    if (action === "resolve-preview") return postResolvePreview(request);
    if (action === "preview-meta") return postPreviewMeta(request);
    if (action === "datasources") return postRemoteDatasources(request);
    if (action === "auth" && rest[0] === "device-code")
      return postAuthDeviceCode();
    if (action === "auth" && rest[0] === "token") return postAuthToken(request);
    if (action === "structure" && (rest[0] === "page" || rest[0] === "template" || rest[0] === "override"))
      return postStructure(request, rest[0]);

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  async function DELETE(
    request: Request,
    { params }: { params: Promise<{ p1?: string[] }> },
  ) {
    const { p1 = [] } = await params;
    const { action, rest } = parseP1Segments(p1);

    if (action === "datasources") return deleteRemoteDatasources(request);
    if (action === "structure" && rest[0] === "page")
      return deleteStructurePage(request);

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return { GET, POST, DELETE };
}
