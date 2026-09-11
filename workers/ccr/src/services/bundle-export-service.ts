/**
 * Bundle Export Service (PCC-3249 / PROPOSAL-013)
 *
 * Queries the database to gather all data needed for a site export bundle.
 * Version selection:
 *   - main branch: all published versions + latest draft if not published
 *   - non-main branch: latest version only
 * createdByRef: portable cross-environment user/agent references.
 */
import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import { agents, checkpointDocuments, checkpoints, documentVersions, users } from '../db/schema';
import { db } from '../db/scope';
import { reconstructVersionSnapshot } from './document-version-service';
import { VersionReconstructionError } from './errors';
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
  createdAt: Date | null;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
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
    const rows = await db()
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    const byId = new Map(rows.map((r) => [r.id, r.email]));
    for (const id of userIds) {
      const email = byId.get(id) ?? null;
      if (email === null) console.warn(`[bundle-export] User UUID ${id} not found — attribution will be null`);
      result.set(id, { type: 'user', email });
    }
  }

  if (agentIds.length > 0) {
    const rows = await db()
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(inArray(agents.id, agentIds));
    const byId = new Map(rows.map((r) => [r.id, r.name]));
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
  checkpointCreatedAt: Date | null;
}

/**
 * Returns publish checkpoints for a document, for inclusion in publish_checkpoints.jsonl.
 * This file is informational only; import reconstructs publish state from versions.jsonl.
 */
export async function getPublishCheckpointsForDocument(
  docId: string,
): Promise<PublishCheckpointRow[]> {
  return await db()
    .select({
      checkpointId: checkpointDocuments.checkpointId,
      documentVersionId: checkpointDocuments.documentVersionId,
      checkpointCreatedAt: checkpoints.createdAt,
    })
    .from(checkpointDocuments)
    .innerJoin(checkpoints, eq(checkpoints.id, checkpointDocuments.checkpointId))
    .where(
      and(
        eq(checkpoints.checkpointType, 'publish'),
        eq(checkpointDocuments.documentId, docId),
      ),
    )
    .orderBy(asc(checkpoints.createdAt));
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
  // A version counts as published when a publish checkpoint references it.
  const isPublished = sql<boolean>`${exists(
    db()
      .select({ published: sql`1` })
      .from(checkpointDocuments)
      .innerJoin(checkpoints, eq(checkpoints.id, checkpointDocuments.checkpointId))
      .where(
        and(
          eq(checkpointDocuments.documentVersionId, documentVersions.id),
          eq(checkpoints.checkpointType, 'publish'),
        ),
      ),
  )}`;

  const rows = await db()
    .select({
      id: documentVersions.id,
      versionNumber: documentVersions.versionNumber,
      snapshot: documentVersions.snapshot,
      isPublished,
      isTombstone: documentVersions.isTombstone,
      createdById: documentVersions.createdById,
      createdByType: documentVersions.createdByType,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.branchId, branchId),
        eq(documentVersions.isTombstone, false),
      ),
    )
    .orderBy(asc(documentVersions.versionNumber));

  // Defense-in-depth: filter tombstones in-memory even though SQL already excludes them.
  const allVersions = rows.filter((row) => !row.isTombstone);
  if (allVersions.length === 0) return [];

  const latestRow = allVersions[allVersions.length - 1];
  if (latestRow === undefined) return [];

  let toExport: typeof allVersions;

  if (!isMainBranch) {
    toExport = [latestRow];
  } else {
    const publishedVersions = allVersions.filter((row) => row.isPublished);
    if (publishedVersions.length === 0) {
      toExport = [latestRow];
    } else if (latestRow.isPublished) {
      toExport = publishedVersions; // latest is already in the published set
    } else {
      toExport = [...publishedVersions, latestRow];
    }
  }

  const resolved: SelectedVersion[] = [];
  for (const row of toExport) {
    let snapshot: Record<string, unknown>;
    // jsonb arrives decoded; the schema declares no shape for it, so it types as unknown.
    const stored = row.snapshot as Record<string, unknown> | null;
    if (stored !== null) {
      snapshot = stored;
    } else {
      // An export covers many versions; one that cannot be rebuilt is dropped
      // from the bundle rather than failing the whole site.
      let reconstructed: Record<string, unknown> | null;
      try {
        reconstructed = await reconstructVersionSnapshot(documentId, branchId, row.versionNumber);
      } catch (error) {
        if (!(error instanceof VersionReconstructionError)) throw error;
        reconstructed = null;
      }
      if (reconstructed === null) {
        const vNum = String(row.versionNumber);
        console.error(
          `[bundle-export] Could not reconstruct snapshot for doc ${documentId} v${vNum} — skipping`,
        );
        continue;
      }
      snapshot = reconstructed;
    }
    resolved.push({
      id: row.id,
      versionNumber: row.versionNumber,
      isPublished: row.isPublished,
      snapshot,
      createdAt: row.createdAt,
      createdById: row.createdById,
      createdByType: row.createdByType as SelectedVersion['createdByType'],
    });
  }
  return resolved;
}
