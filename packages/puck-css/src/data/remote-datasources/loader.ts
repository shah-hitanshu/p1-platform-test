/**
 * Server-side remote data source loading for Puck template resolution (`{{ source.path }}`).
 * Site-specific fetchers are provided via `builtinFetchers` by the consuming app.
 *
 * NOTE: This file imports from the DAL (user-remote-datasource-store) and must
 * NOT be re-exported through the client barrel. Client-safe exports live in
 * `fetch-http-json.ts`.
 */

import {
  isCanonicalTemplatePath,
  resolveTemplateMatch,
  templatePathParamNames,
} from "../route-templates";
import { stripTrailingSlash } from "../paths";
import { listRemoteDatasourcesForPage } from "./user-remote-datasource-store";
import { fetchHttpJsonRemoteDatasource } from "./fetch-http-json";

export type RemoteDatasourceContext = Record<string, unknown>;

// Template ids carry a CSS query name, which is kebab-case, so that branch has to
// admit hyphens. Plain datasource ids deliberately do not.
const TEMPLATE_SOURCE_RE = /\{\{\s*(templates\.[a-zA-Z_][\w-]*|[a-zA-Z_]\w*)\./g;

export function extractReferencedDatasourceIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  const json = JSON.stringify(data);
  let match;
  while ((match = TEMPLATE_SOURCE_RE.exec(json)) !== null) {
    const id = match[1] ?? "";
    if (id && id !== "item" && id !== "urlParams" && id !== "pages") {
      ids.add(id);
    }
  }
  return ids;
}

export type RemoteDatasourceFetcherParams = {
  /** Query params from the URL. */
  searchParams: Record<string, string | string[] | undefined>;
  /** Params captured from route template matching (e.g. { id: "5" } from /jedi/:id). */
  urlParams: Record<string, string>;
  /** Saved preview params from the editor. */
  savedPreviewParams: Record<string, string>;
  /** Fetch implementation to use for HTTP requests. */
  fetchImpl: typeof fetch;
};

export type RemoteDatasourceFetcher = {
  /** The key under which the fetched data appears in the datasource context. */
  id: string;
  /** Fetch function that returns the data for this datasource. */
  fetch: (params: RemoteDatasourceFetcherParams) => Promise<Record<string, unknown>>;
};

function getFirstQueryValue(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  if (searchParams instanceof URLSearchParams) {
    const v = searchParams.get(key);
    return v ?? undefined;
  }
  const raw = searchParams[key];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function getSavedPreviewValue(
  savedPreviewParams: Record<string, string>,
  key: string
): string | undefined {
  const v = savedPreviewParams[key]?.trim();
  return v || undefined;
}

/**
 * Normalize searchParams to a plain object form.
 */
function normalizeSearchParams(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  if (searchParams instanceof URLSearchParams) {
    const out: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((value, key) => {
      const existing = out[key];
      if (existing === undefined) {
        out[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        out[key] = [existing, value];
      }
    });
    return out;
  }
  return searchParams;
}

export type LoadRemoteDatasourceContextOpts = {
  /**
   * Omit for a page rendered ahead of its request. Published pages are cached,
   * so they never read the query string; route template params come from the
   * path either way.
   */
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined>;
  fetchImpl?: typeof fetch;
  pagePath?: string;
  routeTemplateKeys?: string[];
  savedPreviewParams?: Record<string, string>;
  builtinFetchers?: RemoteDatasourceFetcher[];
  /** When set, only fetchers whose id appears in this set will run. */
  referencedDatasourceIds?: Set<string>;
};

/**
 * Load all named remote datasource values for the current request.
 *
 * Resolves URL params from route template matching, saved preview params, and query params,
 * then calls each builtin fetcher and each user-defined HTTP JSON datasource in parallel.
 */
export async function loadRemoteDatasourceContext(
  opts: LoadRemoteDatasourceContextOpts
): Promise<RemoteDatasourceContext> {
  const {
    searchParams = {},
    fetchImpl: fetchImplOpt,
    pagePath,
    routeTemplateKeys = [],
    savedPreviewParams = {},
    builtinFetchers = [],
    referencedDatasourceIds,
  } = opts;
  const fetchImpl = fetchImplOpt ?? fetch;
  const normalizedPath = stripTrailingSlash(pagePath ?? "/");
  const templateMatch =
    normalizedPath && routeTemplateKeys.length > 0
      ? resolveTemplateMatch(normalizedPath, routeTemplateKeys)
      : null;
  const templateKey = templateMatch?.templateKey
    ? templateMatch.templateKey
    : normalizedPath && isCanonicalTemplatePath(normalizedPath, routeTemplateKeys)
      ? normalizedPath
      : undefined;
  const templateParamNames = templateKey ? templatePathParamNames(templateKey) : [];
  const urlParams: Record<string, string> = { ...(templateMatch?.params ?? {}) };
  for (const p of templateParamNames) {
    const saved = getSavedPreviewValue(savedPreviewParams, p);
    if (saved) {
      urlParams[p] = saved;
    }
  }
  for (const p of templateParamNames) {
    const qv = getFirstQueryValue(searchParams, p);
    if (qv) {
      urlParams[p] = qv;
    }
  }

  const normalizedSP = normalizeSearchParams(searchParams);
  const fetcherParams: RemoteDatasourceFetcherParams = {
    searchParams: normalizedSP,
    urlParams,
    savedPreviewParams,
    fetchImpl,
  };

  // Fetch user-defined HTTP JSON datasources
  const userDefs = normalizedPath ? listRemoteDatasourcesForPage(normalizedPath) : { global: [], page: [] };
  const allUserDefs = [...userDefs.global, ...userDefs.page];
  const userContextVars: Record<string, unknown> = { urlParams };

  const activeFetchers = referencedDatasourceIds
    ? builtinFetchers.filter((f) => referencedDatasourceIds.has(f.id))
    : builtinFetchers;
  const activeUserDefs = referencedDatasourceIds
    ? allUserDefs.filter((d) => referencedDatasourceIds.has(d.id))
    : allUserDefs;

  const [builtinResults, userResults] = await Promise.all([
    Promise.all(
      activeFetchers.map(async (f) => [f.id, await f.fetch(fetcherParams)] as const)
    ),
    Promise.all(
      activeUserDefs.map(async (def) => [def.id, await fetchHttpJsonRemoteDatasource(def, userContextVars, fetchImpl)] as const)
    ),
  ]);

  const context: Record<string, unknown> = { urlParams };
  for (const [id, data] of builtinResults) {
    context[id] = data;
  }
  for (const [id, data] of userResults) {
    context[id] = data;
  }
  return context;
}
