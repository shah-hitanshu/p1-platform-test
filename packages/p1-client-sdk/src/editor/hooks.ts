"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Data } from "@puckeditor/core";
import type { RemoteDatasourceContext } from "../lib/remote-datasources/loader";
import type { RemoteDatasourceScope } from "../lib/remote-datasources/user-remote-datasource-types";

const DATASOURCES_KEY = "p1-datasources";
const PREVIEW_KEY = "p1-preview";

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
  return useQuery({
    queryKey: [PREVIEW_KEY, data, remoteDatasourceContext],
    queryFn: async ({ signal }) => {
      const res = await fetch("/p1/api/resolve-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, remoteDatasourceContext }),
        signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: Data };
      return json.data;
    },
    enabled: data != null,
    // Debounce by keeping stale data while refetching
    placeholderData: (prev) => prev,
  });
}

/* ── mutations ── */

export function usePublish(path: string) {
  return useMutation({
    mutationFn: async (data: Data) => {
      const res = await fetch("/p1/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, path }),
      });
      if (!res.ok) throw new Error("Publish failed");
    },
  });
}

export function useSaveRemoteDatasource(editorPath: string) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (body: {
      scope: RemoteDatasourceScope;
      path: string;
      definition: unknown;
    }) => {
      const res = await fetch("/p1/api/datasources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  const router = useRouter();

  return useMutation({
    mutationFn: async (body: {
      scope: RemoteDatasourceScope;
      path: string;
      id: string;
    }) => {
      await fetch("/p1/api/datasources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
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
  const router = useRouter();

  return useMutation({
    mutationFn: async (body: {
      path: string;
      previewParams: Record<string, string>;
    }) => {
      await fetch("/p1/api/preview-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
