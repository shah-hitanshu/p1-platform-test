import { editorMetaStore } from "./dal";
import { isUnsafeKey, stripTrailingSlash } from "./paths";

/** Regex that matches safe route-path keys (e.g. `/`, `/foo/bar`, `/jedi/:id`). */
const SAFE_ROUTE_KEY_REGEX = /^\/[a-zA-Z0-9/:._-]*$/;

/** Regex that matches safe identifier keys (e.g. `id`, `slug`). */
const SAFE_IDENTIFIER_KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// Must stay a type alias: interfaces have no implicit index signature, so an
// interface here would not be assignable to the Record<string, unknown> these
// rows are stored as.
export type PageEditorMetaRow = {
  previewParams?: Record<string, string>;
  datasources?: unknown[];
};

export type PageEditorMetaFile = Record<string, PageEditorMetaRow>;

function normalizePath(path: string): string {
  const p = stripTrailingSlash(path.trim());
  if (isUnsafeKey(p)) return "/";
  return p;
}

/**
 * Persisted preview route params for the Puck editor (e.g. `id` when editing a collection template like `/items/:id`).
 * URL query still overrides these at runtime.
 */
export function getPageEditorPreviewParams(path: string): Record<string, string> {
  const p = normalizePath(path);
  const row = editorMetaStore.get(p);
  const pp = (row as PageEditorMetaRow | undefined)?.previewParams;
  if (!pp || typeof pp !== "object" || Array.isArray(pp)) {
    return {};
  }
  return { ...pp };
}

export function getPageEditorMetaRow(path: string): PageEditorMetaRow {
  const p = normalizePath(path);
  const row = editorMetaStore.get(p);
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {};
  }
  return row as PageEditorMetaRow;
}

export function setPageEditorMetaRow(path: string, row: PageEditorMetaRow): void {
  const p = normalizePath(path);
  if (!SAFE_ROUTE_KEY_REGEX.test(p)) return;
  const next: PageEditorMetaRow = {};
  if (
    row.previewParams &&
    typeof row.previewParams === "object" &&
    !Array.isArray(row.previewParams)
  ) {
    const cleaned: Record<string, string> = Object.create(null);
    for (const [k, v] of Object.entries(row.previewParams)) {
      if (!SAFE_IDENTIFIER_KEY_REGEX.test(k)) continue;
      const t = String(v).trim();
      if (t) cleaned[k] = t;
    }
    if (Object.keys(cleaned).length > 0) {
      next.previewParams = cleaned;
    }
  }
  if (Array.isArray(row.datasources)) {
    next.datasources = row.datasources;
  }
  if (Object.keys(next).length === 0) {
    editorMetaStore.delete(p);
  } else {
    editorMetaStore.set(p, next);
  }
}

/** Remove all editor metadata for a route (e.g. after deleting the page). */
export function removePageEditorMetaPath(path: string): void {
  const p = normalizePath(path);
  if (!SAFE_ROUTE_KEY_REGEX.test(p)) return;
  editorMetaStore.delete(p);
}

export function setPageEditorPreviewParams(
  path: string,
  previewParams: Record<string, string>
): void {
  const p = normalizePath(path);
  if (!SAFE_ROUTE_KEY_REGEX.test(p)) return;
  const cleaned: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(previewParams)) {
    if (!SAFE_IDENTIFIER_KEY_REGEX.test(k)) continue;
    const t = String(v).trim();
    if (t) {
      cleaned[k] = t;
    }
  }

  const prev = (editorMetaStore.get(p) ?? {}) as PageEditorMetaRow;
  if (Object.keys(cleaned).length === 0) {

    const { previewParams, ...rest } = prev;
    if (Object.keys(rest).length === 0) {
      editorMetaStore.delete(p);
    } else {
      editorMetaStore.set(p, rest);
    }
  } else {
    editorMetaStore.set(p, { ...prev, previewParams: cleaned });
  }
}
