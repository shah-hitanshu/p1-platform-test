import type { Data } from "@puckeditor/core";
import { deepClone } from "fast-json-patch";

import { getPageStore } from "./dal";
import type { PageStore } from "./dal/types";
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

/** Regex that matches safe route-path keys (e.g. `/`, `/foo/bar`, `/jedi/:id`). */
const SAFE_ROUTE_KEY_REGEX = /^\/[a-zA-Z0-9/:._-]*$/;

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
  contentTypeTemplateId?: string;
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
 *
 * @param path - Page path (e.g. "/contact-us")
 * @param options.initialData - Optional Puck data to initialize the page with (e.g. scaffolded from a content type template)
 */
export async function createStaticPage(
  path: string,
  options?: { initialData?: Data; templateId?: string; templateVersion?: number },
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {

  const store = getPageStore();
  const normalized = stripTrailingSlash(path.trim());
  if (normalized !== "/" && !/^\/[a-zA-Z0-9/_-]+$/.test(normalized)) {
    return {
      ok: false,
      error: "Use a path like /contact-us (letters, numbers, hyphens, slashes only).",
    };
  }
  if (isReservedPath(normalized)) {
    return { ok: false, error: "That path is reserved for the app." };
  }

  const templateKeys = listRouteTemplateKeys(await store.keys());
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

  if (await store.has(normalized)) {
    return { ok: false, error: "A page with this path already exists." };
  }
  if (!SAFE_ROUTE_KEY_REGEX.test(normalized)) {
    return { ok: false, error: "Invalid path." };
  }

  const pageData = options?.initialData
    ? deepClone(options.initialData) as unknown as Data
    : deepClone(EMPTY_STATIC_PAGE) as unknown as Data;
  const setOptions = options?.templateId
    ? { templateId: options.templateId, templateVersion: options.templateVersion }
    : undefined;
  await store.set(normalized, pageData, setOptions);
  return { ok: true, path: normalized };
}

/**
 * Create a new collection template page (e.g. `/posts/:slug`).
 *
 * @param path - Route template path with at least one :param segment
 * @param options.initialData - Optional Puck data to initialize with (e.g. scaffolded from a content type template)
 */
export async function createCollectionTemplate(
  path: string,
  options?: { initialData?: Data; templateId?: string; templateVersion?: number },
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {

  const store = getPageStore();
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

  if (await store.has(normalized)) {
    return { ok: false, error: "A route with this path already exists." };
  }
  if (!SAFE_ROUTE_KEY_REGEX.test(normalized)) {
    return { ok: false, error: "Invalid path." };
  }

  const pageData = options?.initialData
    ? deepClone(options.initialData) as unknown as Data
    : deepClone(EMPTY_STATIC_PAGE) as unknown as Data;
  const setOptions = options?.templateId
    ? { templateId: options.templateId, templateVersion: options.templateVersion }
    : undefined;
  await store.set(normalized, pageData, setOptions);
  return { ok: true, path: normalized };
}


/**
 * Remove a route. Deleting a collection template also removes overrides
 * and full-document instances that belong to that template.
 */
export async function deletePageAtPath(
  path: string,
  overrideStore?: PageStore,
): Promise<
  | { ok: true; deletedPaths: string[] }
  | { ok: false; error: string }
> {

  const store = overrideStore ?? getPageStore();
  const normalized = stripTrailingSlash(path.trim());
  if (!normalized.startsWith("/") || normalized.includes("..")) {
    return { ok: false, error: "Invalid path." };
  }
  if (isReservedPath(normalized)) {
    return { ok: false, error: "That path is reserved for the app." };
  }

  const entry = await store.get(normalized);
  if (entry === undefined) {
    return { ok: false, error: "No page at this path." };
  }

  const allKeys = await store.keys();
  const templateKeys = listRouteTemplateKeys(allKeys);
  const isTemplateRoot = isPuckData(entry) && isRouteTemplatePath(normalized);

  const toDelete = new Set<string>([normalized]);
  if (isTemplateRoot) {
    const otherKeys = allKeys.filter((p) => p !== normalized);
    const entries = await Promise.all(otherKeys.map(async (p) => [p, await store.get(p)] as const));
    for (const [p, e] of entries) {
      if (isOverrideEntry(e) && e.basePath === normalized) {
        toDelete.add(p);
      } else if (isPuckData(e) && pickTemplateSourcePath(p, templateKeys) === normalized) {
        toDelete.add(p);
      }
    }
  }

  const deletedPaths = Array.from(toDelete).sort();
  await Promise.all(deletedPaths.map((p) => store.delete(p)));
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

export async function resolvePageData(path: string): Promise<Data | null> {

  const store = getPageStore();
  const normalized = stripTrailingSlash(path);

  const entry = await store.get(normalized);

  if (isSemanticPatchEntry(entry)) {
    const base = await resolvePageData(entry.basePath);
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

  const templateKeys = listRouteTemplateKeys(await store.keys());
  const templateKey = pickTemplateSourcePath(normalized, templateKeys);
  if (templateKey) {
    const template = await store.get(templateKey);
    if (isOverrideEntry(template)) {
      return resolvePageData(templateKey);
    }
    if (isPuckData(template)) {
      return deepClone(template) as Data;
    }
  }

  return null;
}

export async function resolveCanonicalForPatchBase(basePath: string): Promise<Data | null> {

  const store = getPageStore();
  const p = stripTrailingSlash(basePath);
  const entry = await store.get(p);

  if (isOverrideEntry(entry)) {
    return resolveCanonicalForPatchBase(entry.basePath);
  }
  if (isPuckData(entry)) {
    return deepClone(entry) as Data;
  }
  return null;
}

export async function persistPublishedPage(path: string, data: Data): Promise<void> {

  const store = getPageStore();
  const normalized = stripTrailingSlash(path);
  if (!SAFE_ROUTE_KEY_REGEX.test(normalized)) return;
  const templateKeys = listRouteTemplateKeys(await store.keys());
  const templateKey = pickTemplateSourcePath(normalized, templateKeys);

  if (templateKey) {
    const canonical = await resolveCanonicalForPatchBase(templateKey);
    if (!canonical) {
      await store.set(normalized, deepClone(data) as unknown as Data);
      return;
    }
    const ops = computeSemanticOps(canonical, data);
    await store.set(normalized, {
      kind: "semantic",
      basePath: templateKey,
      ops,
    });
    return;
  }

  await store.set(normalized, deepClone(data) as unknown as Data);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listRoutes(overrideStore?: PageStore): Promise<RouteRow[]> {

  const store = overrideStore ?? getPageStore();

  // Prefer listDocuments (includes template_id from backend) over plain keys
  const docMetas = store.listDocuments ? await store.listDocuments() : null;
  const allKeys = (docMetas ? docMetas.map((d) => d.path) : await store.keys()).filter((k) => {
    const normalized = k.startsWith('/') ? k.slice(1) : k;
    return !normalized.startsWith('_');
  });
  const templateKeys = listRouteTemplateKeys(allKeys);

  // Build a path→template_id map from document metadata
  const templateIdByPath = new Map<string, string>();
  if (docMetas) {
    for (const doc of docMetas) {
      if (doc.templateId) templateIdByPath.set(doc.path, doc.templateId);
    }
  }

  const entries = await Promise.all(
    allKeys.map(async (path) => [path, await store.get(path)] as const),
  );

  const rows: RouteRow[] = [];
  for (const [path, entry] of entries) {
    const ctTemplateId = templateIdByPath.get(path);
    if (isSemanticPatchEntry(entry)) {
      rows.push({
        path,
        kind: "override",
        basePath: entry.basePath,
        patchOperations: entry.ops.length,
        ...(ctTemplateId ? { contentTypeTemplateId: ctTemplateId } : {}),
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
        ...(ctTemplateId ? { contentTypeTemplateId: ctTemplateId } : {}),
      });
    } else if (entry === null || entry === undefined) {
      rows.push({
        path,
        kind: "static",
        patchOperations: 0,
        ...(ctTemplateId ? { contentTypeTemplateId: ctTemplateId } : {}),
      });
    }
  }

  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** Collection template keys currently in the store (e.g. `/jedi/:id`). */
export async function listRouteTemplateKeysFromDatabase(): Promise<string[]> {

  const store = getPageStore();
  return listRouteTemplateKeys(await store.keys());
}

export async function createCollectionOverride(
  instancePath: string,
  overrideStore?: PageStore,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {

  const store = overrideStore ?? getPageStore();
  const normalized = stripTrailingSlash(instancePath);
  const allKeys = await store.keys();
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

  if (!isPuckData(await store.get(templateKey))) {
    return {
      ok: false,
      error: `Template ${templateKey} is missing. Create that template in the editor first.`,
    };
  }
  if (await store.has(normalized)) {
    return { ok: false, error: "An entry for this path already exists." };
  }
  if (!SAFE_ROUTE_KEY_REGEX.test(normalized)) {
    return { ok: false, error: "Invalid path." };
  }

  await store.set(normalized, {
    kind: "semantic",
    basePath: templateKey,
    ops: [],
  });
  return { ok: true, path: normalized };
}

export async function listOverridePathsForBase(basePath: string): Promise<string[]> {

  const store = getPageStore();
  const keys = await store.keys();
  const entries = await Promise.all(
    keys.map(async (p) => [p, await store.get(p)] as const),
  );
  return entries
    .filter(([, entry]) => isOverrideEntry(entry) && entry.basePath === basePath)
    .map(([p]) => p);
}
