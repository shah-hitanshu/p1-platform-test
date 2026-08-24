/**
 * Canonical component-type casing, read from the component registry.
 *
 * Puck resolves a component's `type` by exact key lookup into its config, so
 * casing is part of a component's identity. The descriptor snapshot's own `name`
 * field is the source of truth for it, and this module is the backend's reader
 * for that field.
 *
 * Reading `name` rather than the document path is deliberate and durable. Today
 * paths are lowercased by normalizePath (correct for page URLs, which are
 * case-insensitive) so the path cannot answer the question at all; even once
 * component paths preserve case, the body stays authoritative and this reader
 * needs no change.
 *
 * @see docs/puck/plans/2026-08-05-component-registry-casing-research.md
 */

import { query } from '../db';
import { escapeLikePattern } from './document-types';
import { componentTypeKey, type CanonicalComponentNames } from './component-type-validation';

const COMPONENT_PREFIX = '_registry/components/';
const TTL_MS = 60 * 1000;

interface CacheEntry {
  loadedAt: number;
  names: CanonicalComponentNames;
}

const cache = new Map<string, CacheEntry>();

/** Test seam — the cache is module-level and outlives a single request. */
export function clearComponentTypeRegistryCache(): void {
  cache.clear();
}

/**
 * Loads every registered component's canonical name for a branch.
 *
 * Descriptors whose snapshot carries no `name` are skipped: there is no way to
 * recover their true casing, and inventing one from the (lowercased) path is
 * what produced the class of bug this module exists to prevent.
 */
export async function loadCanonicalComponentNames(
  branchId: string,
): Promise<CanonicalComponentNames> {
  const cached = cache.get(branchId);
  if (cached !== undefined && Date.now() - cached.loadedAt < TTL_MS) {
    return cached.names;
  }

  const pathPattern = escapeLikePattern(COMPONENT_PREFIX) + '%';

  const result = await query<{ name: string | null }>(
    `SELECT latest.name FROM (
       SELECT DISTINCT ON (dv.document_id)
         dv.snapshot->>'name' AS name, dv.is_tombstone
       FROM app.document_versions dv
       JOIN app.documents d ON d.id = dv.document_id
       WHERE dv.branch_id = $1 AND d.path LIKE $2 ESCAPE '\\'
         AND dv.superseded_at IS NULL
       ORDER BY dv.document_id, dv.version_number DESC
     ) latest
     WHERE latest.is_tombstone = false`,
    [branchId, pathPattern],
  );

  const names: CanonicalComponentNames = new Map();
  for (const row of result.rows) {
    if (row.name !== null && row.name !== '') {
      names.set(componentTypeKey(row.name), row.name);
    }
  }

  cache.set(branchId, { loadedAt: Date.now(), names });
  return names;
}
