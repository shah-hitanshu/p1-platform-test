/**
 * Bundle Export Service (PCC-3249 / PROPOSAL-013)
 *
 * Queries the database to gather all data needed for a site export bundle.
 * Version selection:
 *   - main branch: all published versions + latest draft if not published
 *   - non-main branch: latest version only
 * createdByRef: portable cross-environment user/agent references.
 */
import { query } from '../db';
import { reconstructVersionSnapshot, VersionReconstructionError } from './document-version-service';
import { hmacSha256 } from '../utils/hash';

export type CreatedByRef =
  | { type: 'user'; email: string | null }
  | { type: 'agent'; name: string | null }
  | { type: 'system' };

export interface SelectedVersion {
  id: string;
  versionNumber: number;
  isPublished: boolean;
  snapshot: Record<string, unknown>;
  createdAt: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
}

interface RawVersionRow {
  id: string;
  version_number: number;
  snapshot: Record<string, unknown> | null;
  is_published: boolean;
  is_tombstone: boolean;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
}

/**
 * Batch-resolves createdByRefs for a set of versions, issuing at most two DB
 * round trips (one for users, one for agents) instead of one per version.
 * Returns a Map keyed by createdById UUID.
 */
export async function resolveCreatedByRefsBatch(
  versions: Pick<SelectedVersion, 'createdById' | 'createdByType'>[],
): Promise<Map<string, CreatedByRef>> {
  const result = new Map<string, CreatedByRef>();

  const userIds = [...new Set(versions.filter((v) => v.createdByType === 'user').map((v) => v.createdById))];
  const agentIds = [...new Set(versions.filter((v) => v.createdByType === 'agent').map((v) => v.createdById))];

  // system principals resolve without a DB lookup
  for (const v of versions) {
    if (v.createdByType === 'system') result.set(v.createdById, { type: 'system' });
  }

  if (userIds.length > 0) {
    const rows = await query<{ id: string; email: string }>(
      'SELECT id::text AS id, email FROM app.users WHERE id::text = ANY($1)',
      [userIds],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.email]));
    for (const id of userIds) {
      const email = byId.get(id) ?? null;
      if (email === null) console.warn(`[bundle-export] User UUID ${id} not found — attribution will be null`);
      result.set(id, { type: 'user', email });
    }
  }

  if (agentIds.length > 0) {
    const rows = await query<{ id: string; name: string }>(
      'SELECT id, name FROM app.agents WHERE id = ANY($1::uuid[])',
      [agentIds],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.name]));
    for (const id of agentIds) {
      const name = byId.get(id) ?? null;
      if (name === null) console.warn(`[bundle-export] Agent UUID ${id} not found — attribution will be null`);
      result.set(id, { type: 'agent', name });
    }
  }

  return result;
}

export interface PublishCheckpointRow {
  checkpointId: string;
  documentVersionId: string;
  checkpointCreatedAt: string;
}

/**
 * Returns publish checkpoints for a document, for inclusion in publish_checkpoints.jsonl.
 * This file is informational only; import reconstructs publish state from versions.jsonl.
 */
export async function getPublishCheckpointsForDocument(docId: string): Promise<PublishCheckpointRow[]> {
  const result = await query<{
    checkpoint_id: string;
    document_version_id: string;
    checkpoint_created_at: string;
  }>(
    `SELECT cd.checkpoint_id, cd.document_version_id, cp.created_at AS checkpoint_created_at
     FROM app.checkpoint_documents cd
     JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
     WHERE cp.checkpoint_type = 'publish'
       AND cd.document_id = $1
     ORDER BY cp.created_at ASC`,
    [docId],
  );
  return result.rows.map((r) => ({
    checkpointId: r.checkpoint_id,
    documentVersionId: r.document_version_id,
    checkpointCreatedAt: r.checkpoint_created_at,
  }));
}

/**
 * Signs bundle.json bytes with HMAC-SHA256 using INTERNAL_SECRET.
 * The signature must be returned in the export response and supplied on import
 * so the import handler can reject tampered bundles.
 */
export async function signBundleJson(bundleJsonBytes: Uint8Array, internalSecret: string): Promise<string> {
  return hmacSha256(bundleJsonBytes, internalSecret);
}

/**
 * Selects the versions to include in the export bundle for a single document on a branch.
 *
 * For main branch:
 *   - All versions referenced by a publish checkpoint (is_published=true)
 *   - The latest version if it is not already published (current draft)
 *   - If nothing is published, only the latest version
 * For non-main branch:
 *   - Only the latest version
 *
 * Tombstone versions are excluded.
 * All returned versions have a resolved full snapshot.
 */
export async function selectVersionsForDocument(
  documentId: string,
  branchId: string,
  isMainBranch: boolean,
): Promise<SelectedVersion[]> {
  const result = await query<RawVersionRow>(
    `SELECT
       dv.id,
       dv.version_number,
       dv.snapshot,
       EXISTS(
         SELECT 1 FROM app.checkpoint_documents cd
         JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
         WHERE cd.document_version_id = dv.id
           AND cp.checkpoint_type = 'publish'
       ) AS is_published,
       dv.is_tombstone,
       dv.created_by_id,
       dv.created_by_type,
       dv.created_at
     FROM app.document_versions dv
     WHERE dv.document_id = $1 AND dv.branch_id = $2
       AND dv.is_tombstone = false
     ORDER BY dv.version_number ASC`,
    [documentId, branchId],
  );

  // Defense-in-depth: filter tombstones in-memory even though SQL already excludes them.
  const allVersions = result.rows.filter((row) => !row.is_tombstone);
  if (allVersions.length === 0) return [];

  const latestRow = allVersions[allVersions.length - 1];
  if (latestRow === undefined) return [];

  let toExport: RawVersionRow[];

  if (!isMainBranch) {
    toExport = [latestRow];
  } else {
    const publishedVersions = allVersions.filter((row) => row.is_published);
    if (publishedVersions.length === 0) {
      toExport = [latestRow];
    } else if (latestRow.is_published) {
      toExport = publishedVersions; // latest is already in the published set
    } else {
      toExport = [...publishedVersions, latestRow];
    }
  }

  const resolved: SelectedVersion[] = [];
  for (const row of toExport) {
    let snapshot: Record<string, unknown>;
    if (row.snapshot !== null) {
      snapshot = row.snapshot;
    } else {
      // An export covers many versions; one that cannot be rebuilt is dropped
      // from the bundle rather than failing the whole site.
      let reconstructed: Record<string, unknown> | null;
      try {
        reconstructed = await reconstructVersionSnapshot(documentId, branchId, row.version_number);
      } catch (error) {
        if (!(error instanceof VersionReconstructionError)) throw error;
        reconstructed = null;
      }
      if (reconstructed === null) {
        const vNum = String(row.version_number);
        console.error(
          `[bundle-export] Could not reconstruct snapshot for doc ${documentId} v${vNum} — skipping`,
        );
        continue;
      }
      snapshot = reconstructed;
    }
    resolved.push({
      id: row.id,
      versionNumber: row.version_number,
      isPublished: row.is_published,
      snapshot,
      createdAt: row.created_at,
      createdById: row.created_by_id,
      createdByType: row.created_by_type,
    });
  }
  return resolved;
}
