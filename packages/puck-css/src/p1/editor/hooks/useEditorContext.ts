"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { RemoteDatasourceContext } from "../../../data/remote-datasources/loader";
import type { RemoteDatasourceDefinition } from "../../../data/remote-datasources/remote-datasource-registry";
import type { RouteRow } from "../../../data/page-store";
import { useOptionalP1Auth } from "../../../auth/P1AuthProvider";

interface EditorContextData {
  remoteDatasourceContext: RemoteDatasourceContext;
  routes: RouteRow[];
  routeTemplateKeys: string[];
  savedPreviewParams: Record<string, string>;
  remoteDatasourceRegistry: RemoteDatasourceDefinition[];
}

const EDITOR_CONTEXT_KEY = "p1-editor-context";

export function useEditorContext(path: string, branchId?: string) {
  const auth = useOptionalP1Auth();
  return useQuery<EditorContextData>({
    queryKey: [EDITOR_CONTEXT_KEY, path, branchId],
    queryFn: async (): Promise<EditorContextData> => {
      const token = auth ? await auth.getToken() : null;
      const params = new URLSearchParams({ path });
      if (branchId) params.set("branchId", branchId);
      const url = `/p1/api/editor-context?${params}`;
      const res = token
        ? await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        : await fetch(url);
      if (!res.ok) throw new Error("Failed to load editor context");
      return (await res.json());
    },
    placeholderData: keepPreviousData
  });
}
