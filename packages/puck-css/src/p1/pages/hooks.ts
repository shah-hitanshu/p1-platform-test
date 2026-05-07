"use client";

import { useMutation } from "@tanstack/react-query";
import { useP1Router } from "../router-context";
import { getAuthHeaders } from "../../data/auth";

type StructureKind = "page" | "template" | "override";

export function useCreateStructure(kind: StructureKind) {
  const router = useP1Router();

  return useMutation({
    mutationFn: async (path: string) => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/p1/api/structure/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ path }),
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

  return useMutation({
    mutationFn: async (path: string) => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/p1/api/structure/page", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders },
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
