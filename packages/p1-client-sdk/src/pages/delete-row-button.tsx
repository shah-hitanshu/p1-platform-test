"use client";

import type { RouteKind } from "../lib/page-store";
import { dangerButton } from "../lib/styles";
import { useDeleteStructurePage } from "./hooks";

export function DeleteStructureRowButton({
  path,
  kind,
  disabled,
}: {
  path: string;
  kind: RouteKind;
  disabled?: boolean;
}) {
  const deleteMutation = useDeleteStructurePage();

  if (disabled) {
    return null;
  }

  const templateHint =
    kind === "template"
      ? " This will also remove every override and full instance stored under this template."
      : "";

  function onClick() {
    const ok = window.confirm(
      `Delete ${path} from the site? This cannot be undone.${templateHint}`,
    );
    if (!ok) return;

    deleteMutation.mutate(path, {
      onError: (err) => window.alert(err.message),
    });
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={deleteMutation.isPending}
      style={{ ...dangerButton, marginLeft: 12, cursor: deleteMutation.isPending ? "wait" : undefined }}
    >
      {deleteMutation.isPending ? "Deleting…" : "Delete"}
    </button>
  );
}
