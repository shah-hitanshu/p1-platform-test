"use client";

import { useMutation } from "@tanstack/react-query";
import { useP1Router } from "../router-context";
import { useP1Auth } from "../../auth/P1AuthProvider";

type StructureKind = "page" | "template" | "override";

export function useCreateStructure(kind: StructureKind) {
  const router = useP1Router();
  const { getToken } = useP1Auth();

  return useMutation({
    mutationFn: async (params: string | { path: string; initialData?: unknown; templateId?: string; templateVersion?: number }) => {
      const path = typeof params === "string" ? params : params.path;
      const initialData = typeof params === "string" ? undefined : params.initialData;
      const templateId = typeof params === "string" ? undefined : params.templateId;
      const templateVersion = typeof params === "string" ? undefined : params.templateVersion;
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const body: Record<string, unknown> = { path };
      if (initialData) body.initialData = initialData;
      if (templateId) body.templateId = templateId;
      if (templateVersion !== undefined) body.templateVersion = templateVersion;
      const res = await fetch(`/p1/api/structure/${kind}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        path?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Request failed");
      }
      return data.path ?? path;
    },
    onSuccess: () => {
      router.refresh();
    },
  });
}

export function useDeleteStructurePage() {
  const router = useP1Router();
  const { getToken } = useP1Auth();

  return useMutation({
    mutationFn: async (path: string) => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/p1/api/structure/page", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ path }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        deletedPaths?: string[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Delete failed");
      }
      return data.deletedPaths ?? [];
    },
    onSuccess: () => {
      router.refresh();
    },
  });
}
