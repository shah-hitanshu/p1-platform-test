/**
 * Dynamic route patterns stored as database keys, e.g. `/jedi/:id`, `/starships/:id`, `/test/:a/:b`.
 * Static segments must match exactly; `:param` segments capture any single path segment.
 */

import { stripTrailingSlash } from "./paths";

const PARAM_SEGMENT = /^:[A-Za-z_][A-Za-z0-9_]*$/;

export function normalizeRoutePath(path: string): string {
  return stripTrailingSlash(path.trim());
}

/** Public page URL for navigation (e.g. structure “View”). */
export function publicPagePathHref(routePath: string): string {
  return normalizeRoutePath(routePath || "/");
}

/**
 * P1 editor URL for a stored route. Maps to `/p1/<path>`.
 */
export function editorPathHref(routePath: string): string {
  const n = normalizeRoutePath(routePath || "/");
  if (n === "/") {
    return "/p1/edit";
  }
  return `/p1${n}`;
}

/**
 * Build the storage path from Next.js `[...catchAll]` segments. Each segment is URI-decoded
 * so template keys like `/jedi/:id` work when the URL contains encoded colons (`%3A`).
 */
export function pagePathFromCatchAllSegments(segments: string[] | undefined): string {
  const parts = segments ?? [];
  if (parts.length === 0) {
    return "/";
  }
  const decoded = parts.map((seg) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  });
  return normalizeRoutePath(`/${decoded.join("/")}`);
}

/** True if the path is a template (at least one `:param` segment). */
export function isRouteTemplatePath(path: string): boolean {
  const n = normalizeRoutePath(path);
  if (n === "/") return false;
  return n
    .slice(1)
    .split("/")
    .some((seg) => PARAM_SEGMENT.test(seg));
}

export function pathSegments(path: string): string[] {
  const n = normalizeRoutePath(path);
  if (n === "/") return [];
  return n.slice(1).split("/");
}

/**
 * Example concrete path for a template (each `:param` segment becomes `1`), for structure UI defaults.
 */
export function defaultInstancePathFromTemplate(templatePath: string): string {
  const n = normalizeRoutePath(templatePath);
  if (n === "/") return "/";
  const parts = pathSegments(n);
  const mapped = parts.map((seg) => (PARAM_SEGMENT.test(seg) ? "1" : seg));
  return `/${mapped.join("/")}`;
}

/**
 * If `concrete` matches `template`, returns captured params. Otherwise null.
 */
export function matchConcretePathToTemplateParams(
  concretePath: string,
  templatePath: string
): Record<string, string> | null {
  const ts = pathSegments(templatePath);
  const cs = pathSegments(concretePath);
  if (ts.length !== cs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const c = cs[i];
    if (PARAM_SEGMENT.test(t)) {
      params[t.slice(1)] = c;
    } else if (t !== c) {
      return null;
    }
  }
  return params;
}

/** Keys that look like collection templates (`:param` segments). */
export function listRouteTemplateKeys(allDatabaseKeys: string[]): string[] {
  return allDatabaseKeys.filter((k) => isRouteTemplatePath(k)).sort();
}

/**
 * Sort templates so more specific (more segments) win; then lexicographic.
 */
function sortTemplatesForMatching(templates: string[]): string[] {
  return [...templates].sort((a, b) => {
    const la = pathSegments(a).length;
    const lb = pathSegments(b).length;
    if (lb !== la) return lb - la;
    return a.localeCompare(b);
  });
}

/**
 * If `concretePath` is an instance of a known template, returns that template's storage key.
 * Returns null when `concretePath` is itself the template row or does not match any template.
 */
export function pickTemplateSourcePath(
  concretePath: string,
  templateKeys: string[]
): string | null {
  const c = normalizeRoutePath(concretePath);
  const templates = sortTemplatesForMatching(
    templateKeys.filter((k) => isRouteTemplatePath(k))
  );
  if (templates.some((t) => normalizeRoutePath(t) === c)) {
    return null;
  }
  for (const tmpl of templates) {
    if (matchConcretePathToTemplateParams(c, tmpl) !== null) {
      return normalizeRoutePath(tmpl);
    }
  }
  return null;
}

export function resolveTemplateMatch(
  concretePath: string,
  templateKeys: string[]
): { templateKey: string; params: Record<string, string> } | null {
  const key = pickTemplateSourcePath(concretePath, templateKeys);
  if (!key) return null;
  const params = matchConcretePathToTemplateParams(
    normalizeRoutePath(concretePath),
    key
  );
  if (!params) return null;
  return { templateKey: key, params };
}

/** True when this path is a template row stored in the database (canonical layout). */
export function isCanonicalTemplatePath(
  path: string,
  templateKeys: string[]
): boolean {
  const n = normalizeRoutePath(path);
  return templateKeys.some((k) => normalizeRoutePath(k) === n);
}

/** Parameter names declared on a template path, in order. */
export function templatePathParamNames(templatePath: string): string[] {
  return pathSegments(templatePath)
    .filter((seg) => PARAM_SEGMENT.test(seg))
    .map((seg) => seg.slice(1));
}
