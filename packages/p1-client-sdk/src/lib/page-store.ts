import type { Data } from "@puckeditor/core";
import { deepClone } from "fast-json-patch";

import { pageStore } from "./dal";
import { removePageEditorMetaPath } from "./page-editor-meta";
import {
  isRouteTemplatePath,
  listRouteTemplateKeys,
  pickTemplateSourcePath,
} from "./route-templates";
import {
  applySemanticOps,
  computeSemanticOps,
  type SemanticOp,
} from "./semantic-ops";
import { isReservedPath, stripTrailingSlash } from "./paths";
import { ensureMigrated } from "./page-store-migration";

/** Regex that matches safe route-path keys (e.g. `/`, `/foo/bar`, `/jedi/:id`). */
const SAFE_ROUTE_KEY_REGEX = /^\/[a-zA-Z0-9\/:._\-]*$/;

function sanitizeForLog(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

export type SemanticPatchPageEntry = {
  kind: "semantic";
  basePath: string;
  ops: SemanticOp[];
};

export type OverridePageEntry = SemanticPatchPageEntry;

export type { SemanticOp };

export type RouteKind =
  | "static"
  | "template"
  | "override"
  | "instance-full";

export type RouteRow = {
  path: string;
  kind: RouteKind;
  basePath?: string;
  patchOperations: number;
};

export { flattenStructureRoutes, type FlatStructureRow } from "./page-structure";

const EMPTY_STATIC_PAGE: Data = {
  root: { props: { title: "New page" } },
  content: [],
  zones: {},
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isPuckData(value: unknown): value is Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return "root" in o && typeof o.root === "object" && o.root !== null;
}

export function isSemanticPatchEntry(value: unknown): value is SemanticPatchPageEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as SemanticPatchPageEntry).kind === "semantic" &&
    typeof (value as SemanticPatchPageEntry).basePath === "string" &&
    Array.isArray((value as SemanticPatchPageEntry).ops)
  );
}

export function isOverrideEntry(value: unknown): value is OverridePageEntry {
  return isSemanticPatchEntry(value);
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new full-document page (not a collection override). Use createCollectionOverride for instance paths.
 */
export function createStaticPage(
  path: string
): { ok: true; path: string } | { ok: false; error: string } {
  ensureMigrated();
  const normalized = stripTrailingSlash(path.trim());
  if (normalized !== "/" && !/^\/[a-zA-Z0-9/_\-]+$/.test(normalized)) {
    return {
      ok: false,
      error: "Use a path like /contact-us (letters, numbers, hyphens, slashes only).",
    };
  }
  if (isReservedPath(normalized)) {
    return { ok: false, error: "That path is reserved for the app." };
  }

  const templateKeys = listRouteTemplateKeys(pageStore.keys());
  if (pickTemplateSourcePath(normalized, templateKeys)) {
    return {
      ok: false,
      error:
        "That path matches a collection template instance. Use \u201CAdd collection override\u201D instead of a new full page.",
    };
  }
  if (templateKeys.includes(normalized)) {
    return { ok: false, error: "That path is a collection template key; edit it from the structure list or /edit." };
  }

  if (pageStore.has(normalized)) {
    return { ok: false, error: "A page with this path already exists." };
  }
  if (!SAFE_ROUTE_KEY_REGEX.test(normalized)) {
    return { ok: false, error: "Invalid path." };
  }

  pageStore.set(normalized, deepClone(EMPTY_STATIC_PAGE) as unknown as Data);
  return { ok: true, path: normalized };
}

/**
 * Create a new collection template page (e.g. `/posts/:slug`).
 */
export function createCollectionTemplate(
  path: string
): { ok: true; path: string } | { ok: false; error: string } {
  ensureMigrated();
  const normalized = stripTrailingSlash(path.trim());
  if (!isRouteTemplatePath(normalized)) {
    return {
      ok: false,
      error: "Use a template path with at least one :param segment, e.g. /posts/:slug.",
    };
  }
  if (isReservedPath(normalized)) {
    return { ok: false, error: "That path is reserved for the app." };
  }

  if (pageStore.has(normalized)) {
    return { ok: false, error: "A route with this path already exists." };
  }
  if (!SAFE_ROUTE_KEY_REGEX.test(normalized)) {
    return { ok: false, error: "Invalid path." };
  }

  pageStore.set(normalized, deepClone(EMPTY_STATIC_PAGE) as unknown as Data);
  return { ok: true, path: normalized };
}


/**
 * Remove a route. Deleting a collection template also removes overrides
 * and full-document instances that belong to that template.
 */
export function deletePageAtPath(
  path: string
):
  | { ok: true; deletedPaths: string[] }
  | { ok: false; error: string } {
  ensureMigrated();
  const normalized = stripTrailingSlash(path.trim());
  if (!normalized.startsWith("/") || normalized.includes("..")) {
    return { ok: false, error: "Invalid path." };
  }
  if (isReservedPath(normalized)) {
    return { ok: false, error: "That path is reserved for the app." };
  }

  const entry = pageStore.get(normalized);
  if (entry === undefined) {
    return { ok: false, error: "No page at this path." };
  }

  const allKeys = pageStore.keys();
  const templateKeys = listRouteTemplateKeys(allKeys);
  const isTemplateRoot = isPuckData(entry) && isRouteTemplatePath(normalized);

  const toDelete = new Set<string>([normalized]);
  if (isTemplateRoot) {
    for (const p of allKeys) {
      if (p === normalized) continue;
      const e = pageStore.get(p);
      if (isOverrideEntry(e) && e.basePath === normalized) {
        toDelete.add(p);
      } else if (isPuckData(e) && pickTemplateSourcePath(p, templateKeys) === normalized) {
        toDelete.add(p);
      }
    }
  }

  const deletedPaths = Array.from(toDelete).sort();
  for (const p of deletedPaths) {
    pageStore.delete(p);
  }
  for (const p of deletedPaths) {
    removePageEditorMetaPath(p);
  }

  return { ok: true, deletedPaths };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function routeKindForPath(
  path: string,
  entry: unknown,
  templateKeys: string[]
): RouteKind {
  if (isOverrideEntry(entry)) {
    return "override";
  }
  if (isPuckData(entry) && isRouteTemplatePath(path)) {
    return "template";
  }
  if (pickTemplateSourcePath(path, templateKeys)) {
    return "instance-full";
  }
  return "static";
}

export function resolvePageData(path: string): Data | null {
  ensureMigrated();
  const normalized = stripTrailingSlash(path);

  const entry = pageStore.get(normalized);

  if (isSemanticPatchEntry(entry)) {
    const base = resolvePageData(entry.basePath);
    if (!base) {
      return null;
    }
    try {
      return applySemanticOps(base, entry.ops);
    } catch (e) {
      console.error(
        "[page-store] Failed to apply semantic ops for %s:",
        sanitizeForLog(normalized),
        e
      );
      return deepClone(base) as Data;
    }
  }

  if (isPuckData(entry)) {
    return deepClone(entry) as Data;
  }

  const templateKeys = listRouteTemplateKeys(pageStore.keys());
  const templateKey = pickTemplateSourcePath(normalized, templateKeys);
  if (templateKey) {
    const template = pageStore.get(templateKey);
    if (isOverrideEntry(template)) {
      return resolvePageData(templateKey);
    }
    if (isPuckData(template)) {
      return deepClone(template) as Data;
    }
  }

  return null;
}

export function resolveCanonicalForPatchBase(basePath: string): Data | null {
  ensureMigrated();
  const p = stripTrailingSlash(basePath);
  const entry = pageStore.get(p);

  if (isOverrideEntry(entry)) {
    return resolveCanonicalForPatchBase(entry.basePath);
  }
  if (isPuckData(entry)) {
    return deepClone(entry) as Data;
  }
  return null;
}

export function persistPublishedPage(path: string, data: Data): void {
  ensureMigrated();
  const normalized = stripTrailingSlash(path);
  if (!SAFE_ROUTE_KEY_REGEX.test(normalized)) return;
  const templateKeys = listRouteTemplateKeys(pageStore.keys());
  const templateKey = pickTemplateSourcePath(normalized, templateKeys);

  if (templateKey) {
    const canonical = resolveCanonicalForPatchBase(templateKey);
    if (!canonical) {
      pageStore.set(normalized, deepClone(data) as unknown as Data);
      return;
    }
    const ops = computeSemanticOps(canonical, data);
    pageStore.set(normalized, {
      kind: "semantic",
      basePath: templateKey,
      ops,
    });
    return;
  }

  pageStore.set(normalized, deepClone(data) as unknown as Data);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function listRoutes(): RouteRow[] {
  ensureMigrated();
  const allKeys = pageStore.keys();
  const rows: RouteRow[] = [];
  const templateKeys = listRouteTemplateKeys(allKeys);

  for (const path of allKeys.sort()) {
    const entry = pageStore.get(path);
    if (isSemanticPatchEntry(entry)) {
      rows.push({
        path,
        kind: "override",
        basePath: entry.basePath,
        patchOperations: entry.ops.length,
      });
    } else if (isPuckData(entry)) {
      const kind = routeKindForPath(path, entry, templateKeys);
      const parent =
        kind === "instance-full"
          ? pickTemplateSourcePath(path, templateKeys) ?? undefined
          : undefined;
      rows.push({
        path,
        kind,
        basePath: parent,
        patchOperations: 0,
      });
    }
  }

  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** Collection template keys currently in the store (e.g. `/jedi/:id`). */
export function listRouteTemplateKeysFromDatabase(): string[] {
  ensureMigrated();
  return listRouteTemplateKeys(pageStore.keys());
}

export function createCollectionOverride(
  instancePath: string
): { ok: true; path: string } | { ok: false; error: string } {
  ensureMigrated();
  const normalized = stripTrailingSlash(instancePath);
  const allKeys = pageStore.keys();
  const templateKeys = listRouteTemplateKeys(allKeys);

  if (templateKeys.includes(normalized)) {
    return { ok: false, error: "Cannot create an override for a template storage path itself." };
  }

  const templateKey = pickTemplateSourcePath(normalized, templateKeys);
  if (!templateKey) {
    return {
      ok: false,
      error:
        "Path must match an existing collection template (e.g. /starships/5 for template /starships/:id).",
    };
  }

  if (!isPuckData(pageStore.get(templateKey))) {
    return {
      ok: false,
      error: `Template ${templateKey} is missing. Create that template in the editor first.`,
    };
  }
  if (pageStore.has(normalized)) {
    return { ok: false, error: "An entry for this path already exists." };
  }
  if (!SAFE_ROUTE_KEY_REGEX.test(normalized)) {
    return { ok: false, error: "Invalid path." };
  }

  pageStore.set(normalized, {
    kind: "semantic",
    basePath: templateKey,
    ops: [],
  });
  return { ok: true, path: normalized };
}

export function listOverridePathsForBase(basePath: string): string[] {
  ensureMigrated();
  const out: string[] = [];
  for (const p of pageStore.keys()) {
    const entry = pageStore.get(p);
    if (isOverrideEntry(entry) && entry.basePath === basePath) {
      out.push(p);
    }
  }
  return out;
}
