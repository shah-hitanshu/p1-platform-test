import type { Config, Plugin } from "@puckeditor/core";
import { useMemo } from "react";
import { createPreviewResolvePlugin } from "../editor-preview-resolve";
import { createRemoteDatasourceExplorerPlugin } from "../remote-datasources/remote-datasource-explorer-plugin";
import { createFieldConnectPlugin } from "../connect/field-connect-plugin";

/**
 * A new `plugins` array remounts the whole canvas, so this must stay stable
 * from the first render — never gated behind async data. Plugins read their own
 * live data via useLiveEditorContext/useLiveRemoteDatasources instead.
 */
export function useP1Plugins(path: string, config: Config): Plugin[] {
  return useMemo(
    () => [
      createPreviewResolvePlugin({ editorPath: path }),
      createRemoteDatasourceExplorerPlugin({ editorPath: path }),
      createFieldConnectPlugin({ config, editorPath: path }),
    ],
    [path, config],
  );
}
