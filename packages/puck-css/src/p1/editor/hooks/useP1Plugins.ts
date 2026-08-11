import type { Config, Plugin } from "@puckeditor/core";
import { useMemo } from "react";
import { createPreviewResolvePlugin } from "../editor-preview-resolve";
import { createRemoteDatasourceExplorerPlugin } from "../remote-datasources/remote-datasource-explorer-plugin";
import { createFieldConnectPlugin } from "../connect/field-connect-plugin";
import { useP1PuckOptional } from "../../../core/P1PuckContext";
import { useEditorContext } from "./useEditorContext";

export function useP1Plugins(path: string, config: Config): Plugin[] {
  const p1Puck = useP1PuckOptional();
  const { data: ctx } = useEditorContext(path, p1Puck?.branchId);

  return useMemo(() => {
    if (!ctx) return [];
    return [
      createPreviewResolvePlugin({ editorPath: path }),
      createRemoteDatasourceExplorerPlugin({ editorPath: path }),
      createFieldConnectPlugin({
        routes: ctx.routes,
        config,
        editorPath: path,
        remoteDatasourceRegistry: ctx.remoteDatasourceRegistry,
      }),
    ];
  }, [ctx, path, config]);
}
