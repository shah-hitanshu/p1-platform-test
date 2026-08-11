"use client";

import { useP1PuckOptional } from "../../../core/P1PuckContext";
import type { RouteRow } from "../../../data/page-store";
import type { RemoteDatasourceDefinition } from "../../../data/remote-datasources/remote-datasource-registry";
import { useRemoteDatasourceContext } from "./api-hooks";
import { useEditorContext } from "./useEditorContext";

const EMPTY_REGISTRY: RemoteDatasourceDefinition[] = [];
const EMPTY_ROUTES: RouteRow[] = [];
const EMPTY_TEMPLATE_KEYS: string[] = [];
const EMPTY_PREVIEW_PARAMS: Record<string, string> = {};

/**
 * Live datasource state for components rendered by a Puck plugin.
 *
 * Puck receives its plugin array once per mount — useP1Editor keeps that array
 * identity-stable on purpose, since new plugin objects mean new override
 * component identities, which remounts the canvas and every field. So anything
 * a plugin factory closes over is frozen at creation time, which for datasource
 * data means permanently: the plugins are built the moment the registry first
 * exists, while the context fetch is still in flight.
 *
 * Reading through this hook instead subscribes the component to the same
 * react-query entries the editor host uses, so data, loading state, and the
 * current document path stay live without anything crossing the plugin
 * boundary.
 *
 * `fallbackPath` is only used outside a P1PuckProvider (e.g. the standalone
 * `Client`), where there is no context to read the open document from.
 */
export function useLiveRemoteDatasources(fallbackPath: string) {
  const p1Puck = useP1PuckOptional();
  const path = p1Puck?.currentDocument?.path ?? fallbackPath;
  const branchId = p1Puck?.branchId;

  const { data: editorContext } = useEditorContext(path, branchId);
  const registry = editorContext?.remoteDatasourceRegistry ?? EMPTY_REGISTRY;
  const { context, loadingIds, isLoading } = useRemoteDatasourceContext(
    path,
    registry,
    branchId,
  );

  return {
    path,
    registry,
    context,
    loadingIds,
    isLoading,
    routes: editorContext?.routes ?? EMPTY_ROUTES,
    routeTemplateKeys: editorContext?.routeTemplateKeys ?? EMPTY_TEMPLATE_KEYS,
    savedPreviewParams:
      editorContext?.savedPreviewParams ?? EMPTY_PREVIEW_PARAMS,
  };
}
