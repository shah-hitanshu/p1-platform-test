"use client";

import { useMutation } from "@tanstack/react-query";
import { useP1Router } from "../router-context";
import { useP1Auth } from "../../auth/P1AuthProvider";

type StructureKind = "page" | "template" | "override";

export function useCreateStructure(kind: StructureKind) {
  const router = useP1Router();
  const { getToken } = useP1Auth();

  return useMutation({
    mutationFn: async (path: string) => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/p1/api/structure/${kind}`, {
        method: "POST",
        headers,
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
