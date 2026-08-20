"use client";

import { useP1PuckOptional } from "../../../core/P1PuckContext";
import type { RouteRow } from "../../../data/page-store";
import type { RemoteDatasourceDefinition } from "../../../data/remote-datasources/remote-datasource-registry";
import { useEditorContext } from "./useEditorContext";

const EMPTY_REGISTRY: RemoteDatasourceDefinition[] = [];
const EMPTY_ROUTES: RouteRow[] = [];
const EMPTY_TEMPLATE_KEYS: string[] = [];
const EMPTY_PREVIEW_PARAMS: Record<string, string> = {};

/**
 * Live registry/routes for components rendered by a Puck plugin, without the
 * per-datasource context-resolution queries that useLiveRemoteDatasources
 * also runs. Use this when a component only needs the registry/routes (not
 * resolved datasource values) and is instantiated once per field rather than
 * once per canvas — e.g. field-connect-plugin, which wraps every text field in
 * the sidebar (bound or not), so the full per-datasource query set would be
 * multiplied by the field count for no benefit.
 *
 * `fallbackPath` is only used outside a P1PuckProvider (e.g. the published
 * `EditorClient`), where there is no context to read the open document from.
 */
export function useLiveEditorContext(fallbackPath: string) {
  const p1Puck = useP1PuckOptional();
  const path = p1Puck?.currentDocument?.path ?? fallbackPath;
  const branchId = p1Puck?.branchId;

  const { data: editorContext } = useEditorContext(path, branchId);
  const hasLoaded = editorContext !== undefined;

  return {
    path,
    branchId,
    hasLoaded,
    registry: editorContext?.remoteDatasourceRegistry ?? EMPTY_REGISTRY,
    routes: editorContext?.routes ?? EMPTY_ROUTES,
    routeTemplateKeys: editorContext?.routeTemplateKeys ?? EMPTY_TEMPLATE_KEYS,
    savedPreviewParams:
      editorContext?.savedPreviewParams ?? EMPTY_PREVIEW_PARAMS,
  };
}
