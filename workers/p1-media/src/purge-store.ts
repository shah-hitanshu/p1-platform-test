/**
 * D1 store operations for the hard-purge (legal takedown) path — split from store.ts
 * on purpose. None of the normal read helpers are reusable here:
 * getAsset/assertOwnedAsset/listAssets all filter `deleted_at IS NULL` AND scope by
 * site_id, while a purge must (a) work on an already-soft-deleted asset and (b) run
 * without a site scope — the operator token carries no site-scoped principal.
 */

import type { Env, PrincipalType } from './types';

/** Resolves the owning site of an asset, soft-deleted or not. Null when unknown. */
export async function getAssetSiteId(env: Env, assetId: string): Promise<string | null> {
  const row = await env.MEDIA_DB.prepare('SELECT site_id FROM assets WHERE asset_id = ?')
    .bind(assetId)
    .first<{ site_id: string }>();
  return row?.site_id ?? null;
}

/**
 * Every version's key, not just current_version: superseded versions keep serving
 * (their URLs are pinned inside published documents), so a takedown that missed them
 * would leave the bytes reachable.
 */
export async function listAssetR2Keys(
  env: Env,
  assetId: string,
): Promise<{ versionId: string; r2Key: string }[]> {
  const { results } = await env.MEDIA_DB.prepare(
    'SELECT version_id, r2_key FROM asset_versions WHERE asset_id = ?',
  )
    .bind(assetId)
    .all<{ version_id: string; r2_key: string }>();
  return (results ?? []).map((r) => ({ versionId: r.version_id, r2Key: r.r2_key }));
}

/**
 * Deletes the asset row and every version row in one batch — D1 runs a batch as a
 * single implicit transaction, so a versions-gone/asset-left split is impossible.
 * Returns the number of version rows removed (0 on a repeated call: idempotent).
 */
export async function hardDeleteAssetRows(env: Env, assetId: string): Promise<number> {
  const [versions] = await env.MEDIA_DB.batch([
    env.MEDIA_DB.prepare('DELETE FROM asset_versions WHERE asset_id = ?').bind(assetId),
    env.MEDIA_DB.prepare('DELETE FROM assets WHERE asset_id = ?').bind(assetId),
  ]);
  return versions.meta?.changes ?? 0;
}

export interface PurgeIntent {
  purgeId: string;
  assetId: string;
  siteId: string | null;
  requestedById: string;
  requestedByType: PrincipalType;
  reason: string;
  r2Keys: string[];
  requestedAt: string;
}

/**
 * The pre-destruction audit row. Written BEFORE any delete so a crash mid-purge still
 * leaves a durable record of what was attempted, by whom, over which keys.
 */
export async function insertPurgeIntent(env: Env, intent: PurgeIntent): Promise<void> {
  await env.MEDIA_DB.prepare(
    'INSERT INTO purge_audit (purge_id, asset_id, site_id, requested_by_id, requested_by_type, reason, status, r2_keys, requested_at) ' +
      "VALUES (?, ?, ?, ?, ?, ?, 'intent', ?, ?)",
  )
    .bind(
      intent.purgeId,
      intent.assetId,
      intent.siteId,
      intent.requestedById,
      intent.requestedByType,
      intent.reason,
      JSON.stringify(intent.r2Keys),
      intent.requestedAt,
    )
    .run();
}

export interface PurgeCompletion {
  status: 'completed' | 'partial' | 'failed';
  r2Deleted: number;
  r2Failed: number;
  versionsDeleted: number;
  cachePurgeOutcome: string | null;
  error: string | null;
}

export async function completePurgeAudit(
  env: Env,
  purgeId: string,
  completion: PurgeCompletion,
): Promise<void> {
  await env.MEDIA_DB.prepare(
    'UPDATE purge_audit SET status = ?, r2_deleted = ?, r2_failed = ?, versions_deleted = ?, cache_purge_outcome = ?, error = ?, completed_at = ? WHERE purge_id = ?',
  )
    .bind(
      completion.status,
      completion.r2Deleted,
      completion.r2Failed,
      completion.versionsDeleted,
      completion.cachePurgeOutcome,
      completion.error,
      new Date().toISOString(),
      purgeId,
    )
    .run();
}

/**
 * The most recent COMPLETED purge of an asset, or null. Deliberately ignores
 * intent/partial/failed rows — a stale intent must not short-circuit a retry.
 * This is what makes re-purging idempotent, and it only works because purge_audit
 * outlives the asset row.
 */
export async function findCompletedPurge(
  env: Env,
  assetId: string,
): Promise<{ purgeId: string; siteId: string | null } | null> {
  const row = await env.MEDIA_DB.prepare(
    "SELECT purge_id, site_id FROM purge_audit WHERE asset_id = ? AND status = 'completed' ORDER BY requested_at DESC LIMIT 1",
  )
    .bind(assetId)
    .first<{ purge_id: string; site_id: string | null }>();
  return row ? { purgeId: row.purge_id, siteId: row.site_id } : null;
}

