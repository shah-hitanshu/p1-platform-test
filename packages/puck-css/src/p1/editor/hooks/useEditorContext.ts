"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { RemoteDatasourceContext } from "../../../data/remote-datasources/loader";
import type { RemoteDatasourceDefinition } from "../../../data/remote-datasources/remote-datasource-registry";
import type { RouteRow } from "../../../data/page-store";

interface EditorContextData {
  remoteDatasourceContext: RemoteDatasourceContext;
  routes: RouteRow[];
  routeTemplateKeys: string[];
  savedPreviewParams: Record<string, string>;
  remoteDatasourceRegistry: RemoteDatasourceDefinition[];
}

const EDITOR_CONTEXT_KEY = "p1-editor-context";

export function useEditorContext(path: string) {
  return useQuery<EditorContextData>({
    queryKey: [EDITOR_CONTEXT_KEY, path],
    queryFn: async (): Promise<EditorContextData> => {
      const res = await fetch(
        `/p1/api/editor-context?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw new Error("Failed to load editor context");
      return (await res.json());
    },
    placeholderData: keepPreviousData
  });
}
