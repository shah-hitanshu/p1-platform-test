import { NextResponse } from "next/server";

import {
  normalizePath,
  listRoutes,
  listRouteTemplateKeysFromDatabase,
  getPageEditorPreviewParams,
  buildRemoteDatasourceRegistry,
  listRemoteDatasourcesForPage,
  cssQueriesToDatasourceDefinitions,
  getSharedSiteId,
  getSharedBranchId,
  createAuthenticatedClient,
} from "@pantheon-systems/puck-css/server";
import type {
  RemoteDatasourceFetcher,
  RemoteDatasourceDefinition,
} from "@pantheon-systems/puck-css/server";
import { extractBearerToken } from "../auth-utils";

export interface EditorContextOptions {
  builtinFetchers?: RemoteDatasourceFetcher[];
  builtinDatasourceRegistry?: RemoteDatasourceDefinition[];
}

async function fetchCssQueryDefinitions(request: Request, branchOverride?: string | null): Promise<ReturnType<typeof cssQueriesToDatasourceDefinitions>> {
  const siteId = getSharedSiteId();
  const branchId = branchOverride || getSharedBranchId();
  const token = extractBearerToken(request);
  if (!siteId || !branchId) return [];

  if (!token) return [];
  const client = createAuthenticatedClient(token);
  if (!client?.queries) return [];

  try {
    const queries = await client.queries.list(siteId, branchId);
    return cssQueriesToDatasourceDefinitions(queries);
  } catch {
    return [];
  }
}

export async function getEditorContext(
  request: Request,
  options: EditorContextOptions,
) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") ?? "/";
  const branchId = url.searchParams.get("branchId");
  const path = rawPath === "/" ? "/" : normalizePath(rawPath);
  if (path === null) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const [routes, routeTemplateKeys, savedPreviewParams, userDefs] =
    await Promise.all([
      listRoutes(),
      listRouteTemplateKeysFromDatabase(),
      Promise.resolve(getPageEditorPreviewParams(path)),
      Promise.resolve(listRemoteDatasourcesForPage(path)),
    ]);

  // Must run after listRoutes() — branch ID is lazily resolved during
  // that call, and getSharedBranchId() returns null until it completes.
  const cssQueryDefinitions = await fetchCssQueryDefinitions(request, branchId);

  const remoteDatasourceRegistry = [
    ...buildRemoteDatasourceRegistry(
      options.builtinDatasourceRegistry ?? [],
      userDefs.global,
      userDefs.page,
    ),
    ...cssQueryDefinitions,
  ];

  return NextResponse.json({
    remoteDatasourceContext: {},
    routes,
    routeTemplateKeys,
    savedPreviewParams,
    remoteDatasourceRegistry,
  });
}
