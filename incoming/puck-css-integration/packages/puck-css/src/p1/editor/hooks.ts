"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useP1Router } from "../router-context";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Config, Data, Plugin } from "@puckeditor/core";
import type { RemoteDatasourceContext } from "../../data/remote-datasources/loader";
import type { RemoteDatasourceDefinition } from "../../data/remote-datasources/remote-datasource-registry";
import type { RemoteDatasourceScope } from "../../data/remote-datasources/user-remote-datasource-types";
import type { RouteRow } from "../../data/page-store";
import { useP1Auth } from "../../auth/P1AuthProvider";
import { createPreviewResolvePlugin } from "./editor-preview-resolve";
import { createRemoteDatasourceExplorerPlugin } from "./remote-datasources/remote-datasource-explorer-plugin";
import { createFieldConnectPlugin } from "./connect/field-connect-plugin";

const DATASOURCES_KEY = "p1-datasources";
const PREVIEW_KEY = "p1-preview";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer.current);
  }, [value, delayMs]);
  return debounced;
}

/* ── queries ── */

export function useRemoteDatasources(path: string) {
  return useQuery({
    queryKey: [DATASOURCES_KEY, path],
    queryFn: async () => {
      const res = await fetch(
        `/p1/api/datasources?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw new Error("Failed to load datasources");
      return (await res.json()) as {
        global: unknown[];
        page: unknown[];
      };
    },
  });
}

export function useResolvePreview(
  data: Data | null,
  remoteDatasourceContext: RemoteDatasourceContext,
) {
  const debouncedData = useDebouncedValue(data, 300);
  return useQuery({
    queryKey: [PREVIEW_KEY, debouncedData, remoteDatasourceContext],
    queryFn: async ({ signal }) => {
      const res = await fetch("/p1/api/resolve-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: debouncedData, remoteDatasourceContext }),
        signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: Data };
      return json.data;
    },
    enabled: debouncedData != null,
    placeholderData: (prev) => prev,
  });
}

/* ── mutations ── */

export function usePublish(path: string) {
  const { getToken } = useP1Auth();
  return useMutation({
    mutationFn: async (data: Data) => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/p1/api/publish", {
        method: "POST",
        headers,
        body: JSON.stringify({ data, path }),
      });
      if (!res.ok) throw new Error("Publish failed");
    },
  });
}

export function useSaveRemoteDatasource(editorPath: string) {
  const queryClient = useQueryClient();
  const router = useP1Router();
  const { getToken } = useP1Auth();

  return useMutation({
    mutationFn: async (body: {
      scope: RemoteDatasourceScope;
      path: string;
      definition: unknown;
    }) => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/p1/api/datasources", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Could not save datasource. Check id collisions and required fields.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DATASOURCES_KEY, editorPath] });
      router.refresh();
    },
  });
}

export function useRemoveRemoteDatasource(editorPath: string) {
  const queryClient = useQueryClient();
  const router = useP1Router();
  const { getToken } = useP1Auth();

  return useMutation({
    mutationFn: async (body: {
      scope: RemoteDatasourceScope;
      path: string;
      id: string;
    }) => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await fetch("/p1/api/datasources", {
        method: "DELETE",
        headers,
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DATASOURCES_KEY, editorPath] });
      router.refresh();
    },
  });
}

export function useSavePreviewMeta() {
  const router = useP1Router();
  const { getToken } = useP1Auth();

  return useMutation({
    mutationFn: async (body: {
      path: string;
      previewParams: Record<string, string>;
    }) => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await fetch("/p1/api/preview-meta", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      router.refresh();
    },
  });
}

export function useLoadPageData() {
  return useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(
        `/p1/api/page-data?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw new Error("Could not load page data.");
      const json = (await res.json()) as { data: Data };
      return json.data;
    },
  });
}

/* ── editor context ── */

interface EditorContextData {
  remoteDatasourceContext: RemoteDatasourceContext;
  routes: RouteRow[];
  routeTemplateKeys: string[];
  savedPreviewParams: Record<string, string>;
  remoteDatasourceRegistry: RemoteDatasourceDefinition[];
}

const EDITOR_CONTEXT_KEY = "p1-editor-context";

export function useEditorContext(path: string) {
  return useQuery({
    queryKey: [EDITOR_CONTEXT_KEY, path],
    queryFn: async () => {
      const res = await fetch(
        `/p1/api/editor-context?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw new Error("Failed to load editor context");
      return (await res.json()) as EditorContextData;
    },
  });
}

/* ── progressive datasource context ── */

const DATASOURCE_CONTEXT_KEY = "p1-datasource-context";

export function useRemoteDatasourceContext(
  path: string,
  registry: RemoteDatasourceDefinition[],
): { context: RemoteDatasourceContext; loadingIds: Set<string>; isLoading: boolean } {
  const queries = useQueries({
    queries: registry.map((def) => ({
      queryKey: [DATASOURCE_CONTEXT_KEY, path, def.id],
      queryFn: async () => {
        const res = await fetch(
          `/p1/api/datasource-context?path=${encodeURIComponent(path)}&id=${encodeURIComponent(def.id)}`,
        );
        if (!res.ok) return { id: def.id, data: {} };
        return (await res.json()) as { id: string; data: Record<string, unknown> };
      },
    })),
  });

  return useMemo(() => {
    const context: RemoteDatasourceContext = {};
    const loadingIds = new Set<string>();
    let isLoading = false;

    for (let i = 0; i < registry.length; i++) {
      const def = registry[i];
      const query = queries[i];
      if (!def || !query) continue;
      if (query.isLoading || query.isFetching) {
        loadingIds.add(def.id);
        isLoading = true;
      } else if (query.data) {
        context[def.id] = query.data.data;
      }
    }

    return { context, loadingIds, isLoading };
  }, [registry, queries]);
}

/* ── P1 plugins ── */

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
