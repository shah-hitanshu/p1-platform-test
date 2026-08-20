"use client";

import { useRemoteDatasourceContext } from "./api-hooks";
import { useLiveEditorContext } from "./useLiveEditorContext";

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
 * This also resolves each registry entry's datasource context (one query per
 * entry) — only use it where that's actually needed. A component instantiated
 * once per field should use useLiveEditorContext instead, which skips that.
 *
 * `fallbackPath` is only used outside a P1PuckProvider (e.g. the published
 * `EditorClient`), where there is no context to read the open document from.
 */
export function useLiveRemoteDatasources(fallbackPath: string) {
  const live = useLiveEditorContext(fallbackPath);
  const { context, loadingIds, isLoading } = useRemoteDatasourceContext(
    live.path,
    live.registry,
    live.branchId,
  );

  return {
    ...live,
    context,
    loadingIds,
    isLoading,
  };
}
