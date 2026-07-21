import { NextResponse } from "next/server";

import {
  normalizePath,
  listRoutes,
  listRouteTemplateKeysFromDatabase,
  getPageEditorPreviewParams,
  buildRemoteDatasourceRegistry,
  listRemoteDatasourcesForPage,
} from "@pantheon-systems/puck-css/server";
import type {
  RemoteDatasourceFetcher,
  RemoteDatasourceDefinition,
} from "@pantheon-systems/puck-css/server";

export interface EditorContextOptions {
  builtinFetchers?: RemoteDatasourceFetcher[];
  builtinDatasourceRegistry?: RemoteDatasourceDefinition[];
}

export async function getEditorContext(
  request: Request,
  options: EditorContextOptions,
) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") ?? "/";
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

  const remoteDatasourceRegistry = buildRemoteDatasourceRegistry(
    options.builtinDatasourceRegistry ?? [],
    userDefs.global,
    userDefs.page,
  );

  return NextResponse.json({
    remoteDatasourceContext: {},
    routes,
    routeTemplateKeys,
    savedPreviewParams,
    remoteDatasourceRegistry,
  });
}
