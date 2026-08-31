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
  runWithAuthToken,
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

async function fetchCcrQueryDefinitions(request: Request, branchOverride?: string | null): Promise<ReturnType<typeof cssQueriesToDatasourceDefinitions>> {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[P1] Editor context: query lookup failed:", message);
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

  // Unlike getRoutes, a missing token degrades rather than 401s: the editor
  // falls back to an unauthenticated fetch and treats any error response as
  // fatal, so rejecting here would break auth-optional deployments.
  const token = extractBearerToken(request);
  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    token ? runWithAuthToken(token, fn) : fn();

  return run(() => buildEditorContext(request, options, path, branchId));
}

async function buildEditorContext(
  request: Request,
  options: EditorContextOptions,
  path: string,
  branchId: string | null,
) {
  const [routes, routeTemplateKeys, savedPreviewParams, userDefs] =
    await Promise.all([
      listRoutes(),
      listRouteTemplateKeysFromDatabase(),
      Promise.resolve(getPageEditorPreviewParams(path)),
      Promise.resolve(listRemoteDatasourcesForPage(path)),
    ]);

  // Must run after listRoutes() — branch ID is lazily resolved during
  // that call, and getSharedBranchId() returns null until it completes.
  const ccrQueryDefinitions = await fetchCcrQueryDefinitions(request, branchId);

  const remoteDatasourceRegistry = [
    ...buildRemoteDatasourceRegistry(
      options.builtinDatasourceRegistry ?? [],
      userDefs.global,
      userDefs.page,
    ),
    ...ccrQueryDefinitions,
  ];

  return NextResponse.json({
    remoteDatasourceContext: {},
    routes,
    routeTemplateKeys,
    savedPreviewParams,
    remoteDatasourceRegistry,
  });
}
