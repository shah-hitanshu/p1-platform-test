import type { Config, Plugin } from "@puckeditor/core";
import { useMemo } from "react";
import { createPreviewResolvePlugin } from "../editor-preview-resolve";
import { createRemoteDatasourceExplorerPlugin } from "../remote-datasources/remote-datasource-explorer-plugin";
import { createFieldConnectPlugin } from "../connect/field-connect-plugin";
import { useEditorContext } from "./useEditorContext";
import { useRemoteDatasourceContext } from "./api-hooks";

export function useP1Plugins(path: string, config: Config): Plugin[] {
  const { data: ctx } = useEditorContext(path);
  const {
    context: remoteDatasourceContext,
    loadingIds,
    isLoading: datasourcesLoading,
  } = useRemoteDatasourceContext(path, ctx?.remoteDatasourceRegistry ?? []);

  return useMemo(() => {
    if (!ctx) return [];
    return [
      createPreviewResolvePlugin(remoteDatasourceContext, { loading: datasourcesLoading }),
      createRemoteDatasourceExplorerPlugin(remoteDatasourceContext, {
        editorPath: path,
        routeTemplateKeys: ctx.routeTemplateKeys,
        savedPreviewParams: ctx.savedPreviewParams,
        remoteDatasourceRegistry: ctx.remoteDatasourceRegistry,
        loadingIds,
      }),
      createFieldConnectPlugin({
        routes: ctx.routes,
        config,
        editorPath: path,
        remoteDatasourceRegistry: ctx.remoteDatasourceRegistry,
      }),
    ];
  }, [ctx, remoteDatasourceContext, loadingIds, datasourcesLoading, path, config]);
}
