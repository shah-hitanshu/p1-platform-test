/**
 * One-time migration: fix %3A-encoded path keys in the local page store.
 * Runs lazily on first access to page-store CRUD/query functions.
 */

import type { Data } from "@puckeditor/core";

import { pageStore } from "./dal";
import { applySemanticOps, type SemanticOp } from "./semantic-ops";

function isPuckData(value: unknown): value is Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return "root" in o && typeof o.root === "object" && o.root !== null;
}

type SemanticPatchEntry = {
  kind: "semantic";
  basePath: string;
  ops: SemanticOp[];
};

function isSemanticPatchEntry(value: unknown): value is SemanticPatchEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as SemanticPatchEntry).kind === "semantic" &&
    typeof (value as SemanticPatchEntry).basePath === "string" &&
    Array.isArray((value as SemanticPatchEntry).ops)
  );
}

let _migrated = false;

export function ensureMigrated(): void {
  if (_migrated) return;
  _migrated = true;

  const keys = pageStore.keys();
  for (const k of keys) {
    if (!/%3a/i.test(k)) continue;
    const canonical = k.replace(/%3A/gi, ":");
    if (canonical === k) continue;
    const entry = pageStore.get(k);
    if (entry === undefined) continue;

    const target = pageStore.get(canonical);
    if (target === undefined) {
      if (isPuckData(entry)) {
        pageStore.set(canonical, entry);
        pageStore.delete(k);
      }
      continue;
    }

    if (isPuckData(target) && isSemanticPatchEntry(entry) && entry.basePath === canonical) {
      try {
        pageStore.set(canonical, applySemanticOps(target as Data, entry.ops));
        pageStore.delete(k);
      } catch {
        /* leave both */
      }
    }
  }
}
