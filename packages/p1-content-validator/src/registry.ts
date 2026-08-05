import type { ComponentSchema, ComponentField, FetchRegistryOpts } from './types.js';

// ---------------------------------------------------------------------------
// Registry key normalization
//
// Document paths (including "_registry/components/{Name}") are lowercased
// server-side on write (see workers/src/services/document-types.ts
// normalizePath), but the component's real, original-case name is preserved
// in the descriptor snapshot body's own `name` field. Lookups against the
// registry must therefore be case-insensitive, while the schema's `name`
// (what's stored/displayed to callers) stays the true original case.
//
// Mirrors the `registryComponentKey` pattern established in p1-chatbot /
// puck-css-integration#122 for the client-side registry — same name, same
// approach, so both sides of the registry stay consistent.
// ---------------------------------------------------------------------------

export function registryComponentKey(name: string): string {
  return name.toLowerCase();
}

const REGISTRY_COMPONENTS_PATH_PREFIX = '_registry/components/';

/**
 * Derives a component's fallback name from its registry document path
 * (e.g. "_registry/components/leadcapture" -> "leadcapture"). This is a
 * fallback only — paths are lowercased server-side, so the result does not
 * reflect the component's real casing (e.g. "LeadCapture"). The descriptor
 * snapshot's own `name` field (see `snapshotToComponentSchema`) is the
 * source of truth for the real, original-case name.
 */
export function componentNameFromPath(path: string): string {
  return path.slice(REGISTRY_COMPONENTS_PATH_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Shared snapshot → ComponentSchema transformation
// Used by both fetchRegistry (raw fetch path) and McpApiClient.fetchRegistrySchemas
// (circuit-breaker-wrapped path) to ensure consistent extraction logic.
// ---------------------------------------------------------------------------

/**
 * Returns null when the descriptor carries no usable `name`.
 *
 * There used to be a fallback to the path-derived name here. A document path
 * cannot carry a component's casing reliably, so that fallback invented one and
 * advertised it as a valid component type — teaching every consumer (and every
 * agent calling list_components) a casing Puck may not resolve. A descriptor
 * with no `name` is corrupt; callers must skip and log it rather than guess.
 *
 * This holds however paths are stored: the descriptor body is the source of
 * truth for casing, so the path is never the place to recover it from.
 */
export function snapshotToComponentSchema(
  snapshot: Record<string, unknown>,
): ComponentSchema | null {
  if (typeof snapshot.name !== 'string' || snapshot.name === '') {
    return null;
  }
  return {
    name: snapshot.name,
    defaultProps: (snapshot.defaultProps as Record<string, unknown> | undefined) ?? {},
    allowedAdditionalProps: Array.isArray(snapshot.allowedAdditionalProps)
      ? (snapshot.allowedAdditionalProps as string[])
      : undefined,
    opaqueProps: Array.isArray(snapshot.opaqueProps)
      ? (snapshot.opaqueProps as string[])
      : undefined,
    fields: Array.isArray(snapshot.fields)
      ? (snapshot.fields as ComponentField[])
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Module-level TTL cache — persists across calls within the same process
// ---------------------------------------------------------------------------

interface CacheEntry {
  cachedAt: number;
  schemas: Record<string, ComponentSchema>;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(cssBaseUrl: string, siteId: string, branchId: string): string {
  return `${cssBaseUrl}:${siteId}:${branchId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and cache all component schemas from the CSS registry.
 *
 * Makes two types of requests:
 *   1. GET /api/sites/{siteId}/branches/{branchId}/documents?pathPrefix=_registry%2Fcomponents%2F
 *   2. GET .../versions/latest  for each component document
 *
 * Results are cached per (cssBaseUrl, siteId, branchId) with a 5-minute TTL.
 * If the cache is fresh, no network calls are made.
 */
export async function fetchRegistry(
  cssBaseUrl: string,
  siteId: string,
  branchId: string,
  opts: FetchRegistryOpts,
): Promise<Record<string, ComponentSchema>> {
  const key = cacheKey(cssBaseUrl, siteId, branchId);
  const cached = cache.get(key);
  if (cached !== undefined && Date.now() - cached.cachedAt < TTL_MS) {
    return cached.schemas;
  }

  const base = cssBaseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': opts.token,
  };

  const listUrl =
    `${base}/api/sites/${siteId}/branches/${branchId}/documents` +
    `?pathPrefix=${encodeURIComponent('_registry/components/')}`;

  const listRes = await fetch(listUrl, { method: 'GET', headers, signal: opts.signal });
  if (!listRes.ok) {
    throw new Error(`fetchRegistry: list failed with ${String(listRes.status)}`);
  }

  const { documents } = (await listRes.json()) as {
    documents: { id: string; path: string }[];
  };

  if (documents.length === 0) {
    // Cache the empty result so we don't re-hit listDocuments on every call within the TTL
    cache.set(key, { cachedAt: Date.now(), schemas: {} });
    return {};
  }

  const schemas: Record<string, ComponentSchema> = {};

  await Promise.all(
    documents.map(async (doc) => {
      const versionUrl =
        `${base}/api/sites/${siteId}/branches/${branchId}/documents/${doc.id}/versions/latest`;
      try {
        const vRes = await fetch(versionUrl, { method: 'GET', headers, signal: opts.signal });
        if (!vRes.ok) return;
        const { snapshot } = (await vRes.json()) as { snapshot: Record<string, unknown> };
        const schema = snapshotToComponentSchema(snapshot);
        if (schema === null) {
          console.warn(
            `[p1-content-validator] Registry descriptor at "${doc.path}" has no "name" — ` +
              'skipping. Its component cannot be validated until the descriptor is rewritten ' +
              '(reopen the editor or rerun the registry sync).',
          );
          return;
        }
        schemas[registryComponentKey(schema.name)] = schema;
      } catch {
        // Skip components that fail to fetch — don't block the rest
      }
    }),
  );

  cache.set(key, { cachedAt: Date.now(), schemas });
  return schemas;
}

/**
 * Metadata-only listing: returns one entry per component with its document ID.
 * Useful for cache invalidation checks — compare IDs against a local cache
 * to detect which component schemas have been updated without fetching bodies.
 *
 * Note: the CSS list endpoint does not currently expose versionId; the document
 * id is returned as a stable identifier. Full version-id tracking requires a
 * backend extension (tracked separately).
 */
export async function listRegistryVersions(
  cssBaseUrl: string,
  siteId: string,
  branchId: string,
  opts: FetchRegistryOpts,
): Promise<{ name: string; versionId: string }[]> {
  const base = cssBaseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': opts.token,
  };

  const listUrl =
    `${base}/api/sites/${siteId}/branches/${branchId}/documents` +
    `?pathPrefix=${encodeURIComponent('_registry/components/')}`;

  const res = await fetch(listUrl, { method: 'GET', headers, signal: opts.signal });
  if (!res.ok) {
    throw new Error(`listRegistryVersions: list failed with ${String(res.status)}`);
  }

  const { documents } = (await res.json()) as {
    documents: { id: string; path: string }[];
  };

  return documents.map((doc) => ({
    name: componentNameFromPath(doc.path),
    versionId: doc.id, // document id as proxy until backend exposes versionId
  }));
}
