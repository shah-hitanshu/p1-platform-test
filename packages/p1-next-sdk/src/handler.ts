/**
 * P1 Next SDK handler — NextAuth-style catch-all for `/p1/api/[...p1]`.
 *
 * Usage in your Next.js app:
 *
 *   // app/p1/api/[...p1]/route.ts
 *   import { createP1Handler } from "@pantheon-systems/p1-next-sdk";
 *   import config from "../../../../puck.config";
 *   const handler = createP1Handler({ config });
 *   export const { GET, POST, DELETE } = handler;
 */

import type { Config } from "@puckeditor/core";
import { NextResponse } from "next/server";

import type { RemoteDatasourceFetcher, RemoteDatasourceDefinition } from "@pantheon-systems/puck-css/server";
import { ensureInitialized, type P1DataConfig } from "@pantheon-systems/puck-css/server";
import { runWithAuthToken } from "@pantheon-systems/puck-css/server";

import {
  getPageData,
  getRemoteDatasources,
  getEditorContext,
  getDatasourceContext,
  getRoutes,
  postPublish,
  postResolvePreview,
  postPreviewMeta,
  postRemoteDatasources,
  deleteRemoteDatasources,
} from "./handler-actions";

/** Extract the sub-path segments from the catch-all `p1` param under `/p1/api/`. */
function parseP1Segments(p1: string[]): { action: string; rest: string[] } {
  if (p1.length === 0) return { action: "", rest: [] };
  const [first, ...rest] = p1;
  return { action: first, rest };
}

export type P1HandlerConfig = P1DataConfig & {
  config: Config;
  builtinFetchers?: RemoteDatasourceFetcher[];
  builtinDatasourceRegistry?: RemoteDatasourceDefinition[];
};

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function withAuth<T>(request: Request, fn: () => T): T | NextResponse {
  const token = extractBearerToken(request);
  if (token) return runWithAuthToken(token, fn);
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function createP1Handler(opts: P1HandlerConfig) {
  const initPromise = ensureInitialized(opts);

  async function GET(
    request: Request,
    { params }: { params: Promise<{ p1?: string[] }> },
  ) {
    await initPromise;
    const { p1 = [] } = await params;
    const { action } = parseP1Segments(p1);

    if (action === "page-data") return getPageData(request);
    if (action === "datasources") return getRemoteDatasources(request);
    if (action === "editor-context")
      return getEditorContext(request, {
        builtinFetchers: opts.builtinFetchers,
        builtinDatasourceRegistry: opts.builtinDatasourceRegistry,
      });
    if (action === "datasource-context")
      return getDatasourceContext(request, {
        builtinFetchers: opts.builtinFetchers,
      });
    if (action === "routes") return getRoutes(request);

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  async function POST(
    request: Request,
    { params }: { params: Promise<{ p1?: string[] }> },
  ) {
    await initPromise;
    const { p1 = [] } = await params;
    const { action } = parseP1Segments(p1);

    if (action === "publish") return withAuth(request, () => postPublish(request));
    if (action === "resolve-preview") return postResolvePreview(request);
    if (action === "preview-meta") return postPreviewMeta(request);
    if (action === "datasources") return withAuth(request, () => postRemoteDatasources(request));

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  async function DELETE(
    request: Request,
    { params }: { params: Promise<{ p1?: string[] }> },
  ) {
    await initPromise;
    const { p1 = [] } = await params;
    const { action } = parseP1Segments(p1);

    if (action === "datasources") return withAuth(request, () => deleteRemoteDatasources(request));

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return { GET, POST, DELETE };
}
