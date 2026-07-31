import { NextResponse } from "next/server";
import { extractBearerToken } from "../auth-utils";

import {
  normalizePath,
  listRouteTemplateKeysFromDatabase,
  getPageEditorPreviewParams,
  loadRemoteDatasourceContext,
  createAuthenticatedClient,
} from "@pantheon-systems/puck-css/server";
import type {
  RemoteDatasourceFetcher,
} from "@pantheon-systems/puck-css/server";
import { createCssQueryFetchers } from "../css-query-fetchers";

export interface DatasourceContextOptions {
  builtinFetchers?: RemoteDatasourceFetcher[];
}

export async function getDatasourceContext(
  request: Request,
  options: DatasourceContextOptions,
) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") ?? "/";
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const path = rawPath === "/" ? "/" : normalizePath(rawPath);
  if (path === null) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const [routeTemplateKeys, savedPreviewParams] = await Promise.all([
    listRouteTemplateKeysFromDatabase(),
    Promise.resolve(getPageEditorPreviewParams(path)),
  ]);

  const branchId = url.searchParams.get("branchId");
  const referencedDatasourceIds = new Set([id]);

  const token = extractBearerToken(request);
  const client = token ? createAuthenticatedClient(token) : null;

  const cssQueryFetchers = await createCssQueryFetchers({
    client,
    branchId,
    filterIds: referencedDatasourceIds,
  });

  const allFetchers = [...(options.builtinFetchers ?? []), ...cssQueryFetchers];

  const context = await loadRemoteDatasourceContext({
    searchParams: Object.fromEntries(url.searchParams.entries()),
    pagePath: path,
    routeTemplateKeys,
    savedPreviewParams,
    builtinFetchers: allFetchers,
    referencedDatasourceIds,
  });

  const data = context[id] ?? {};
  return NextResponse.json({ id, data });
}
