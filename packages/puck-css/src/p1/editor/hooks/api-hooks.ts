"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useP1Router } from "../../router-context";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "@puckeditor/core";
import type { RemoteDatasourceContext } from "../../../data/remote-datasources/loader";
import type { RemoteDatasourceDefinition } from "../../../data/remote-datasources/remote-datasource-registry";
import type { RemoteDatasourceScope } from "../../../data/remote-datasources/user-remote-datasource-types";
import { useP1Auth } from "../../../auth/P1AuthProvider";

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

  // keepPreviousData is ignored by useQueries (observers are recreated when
  // the path changes the query keys), so previous-path data is carried over
  // manually: without it the context empties mid page-switch and consumers
  // flash empty states.
  const lastGoodRef = useRef<Record<string, Record<string, unknown>>>({});

  const result = useMemo(() => {
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
      }
      if (query.data) {
        context[def.id] = query.data.data;
      } else if (!query.isError && lastGoodRef.current[def.id]) {
        context[def.id] = lastGoodRef.current[def.id];
      }
    }

    return { context, loadingIds, isLoading };
  }, [registry, queries]);

  // Written from a commit effect, not the memo factory above: useMemo is a
  // memoization hint rather than a once-per-commit guarantee, so carrying state
  // forward from inside it is a render-phase side effect.
  useEffect(() => {
    for (let i = 0; i < registry.length; i++) {
      const def = registry[i];
      const query = queries[i];
      if (!def || !query) continue;
      if (query.data) {
        lastGoodRef.current[def.id] = query.data.data;
      } else if (query.isError) {
        // Settled failure: drop the carried-over entry rather than keep
        // showing the previous path's data as if it belonged to this page.
        delete lastGoodRef.current[def.id];
      }
    }
  }, [registry, queries]);

  return result;
}
