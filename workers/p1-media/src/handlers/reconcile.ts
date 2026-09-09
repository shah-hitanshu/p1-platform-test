import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../types';
import { findExpiredChatAssets, hardDeleteChatAsset } from '../store';

// Must stay far larger than a normal presign -> PUT -> finalize round trip (seconds),
// since it's the only thing standing between reconcile and racing an in-flight
// finalize. See handleReconcile's docstring for the full argument — do not lower this
// without re-deriving that safety margin.
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000; // 24h

// Each deletion costs two subrequests, and this shares an invocation (and the Workers
// subrequest ceiling) with handleReconcile. Capped so the first armed run against a backlog
// can't blow the limit and take the orphan job down with it. The hourly cadence still clears
// far more than a steady state produces.
const MAX_CHAT_DELETIONS_PER_RUN = 200;

export interface ChatSweepResult {
  candidates: number;
  deleted: number;
  /** Eligible but left for the next run because the per-run cap was reached. */
  deferred: number;
  /** Attempted and threw. Left in place; the next run picks them up again. */
  failed: number;
  dryRun: boolean;
}

/**
 * Hard-deletes chat attachments that have aged out or whose conversation was cleared. This is
 * the only path that removes bytes a user uploaded, so it shares RECONCILE_DRY_RUN with the
 * orphan job and fails safe the same way.
 *
 * Must run BEFORE handleReconcile in the same trigger: that job snapshots asset_versions up
 * front, and anything deleted afterwards makes the snapshot stale.
 *
 * Promoted assets can't be hit here — they are no longer origin='chat', which both the query
 * and hardDeleteChatAsset's guard require.
 */
export async function sweepExpiredChatAssets(env: Env): Promise<ChatSweepResult> {
  const dryRun = env.RECONCILE_DRY_RUN !== 'false';
  const { assets, total } = await findExpiredChatAssets(env, new Date().toISOString(), MAX_CHAT_DELETIONS_PER_RUN);
  const deferred = total - assets.length;

  let deleted = 0;
  let failed = 0;
  for (const asset of assets) {
    if (!dryRun) {
      // Per asset, so one unreachable object doesn't cost the rest of the batch — or
      // handleReconcile, which shares this invocation.
      try {
        // Row first, guarded on origin: once that returns true the asset cannot have been
        // promoted, so its bytes are safe to drop. The cost is that an R2 failure after it
        // leaves bytes with no row — invisible to this sweep, collected by handleReconcile
        // as an orphan on a later run.
        if (!(await hardDeleteChatAsset(env, asset.assetId))) continue;
        for (const key of asset.r2Keys) await env.MEDIA_BUCKET.delete(key);
        deleted++;
      } catch {
        failed++;
        continue;
      }
    }
    // asset_id is a structured field, not interpolated: it is on the telemetry allowlist
    // and stays queryable, where a format string would only be text.
    getLogger().info('chat retention candidate', {
      asset_id: asset.assetId,
      objects: asset.r2Keys.length,
      outcome: dryRun ? 'dry_run' : 'deleted',
    });
  }

  getLogger().info('chat retention sweep complete', {
    candidates: total, deleted, deferred, failed, dryRun,
  });
  return { candidates: total, deleted, deferred, failed, dryRun };
}

export interface ReconcileResult {
  candidates: number;
  deleted: number;
  dryRun: boolean;
}

/**
 * Deletes R2 objects that no asset_versions row references and that are older than
 * ORPHAN_AGE_MS. This is the routine byproduct of a presigned upload whose PUT
 * succeeded but whose finalize was never called (tab closed, network blip, an
 * abandoned edit) — under the old multipart path this required a genuine D1 failure
 * to produce; under presign/finalize it's normal abandonment, so nothing sweeps it
 * except this job.
 *
 * Safety argument: finalize's confirmUploadedObject() calls head() BEFORE writing any
 * D1 row (see handlers/finalize.ts), so a race where this job deletes an object
 * finalize was about to reference just makes that finalize 404 — the client retries,
 * no dangling row is ever written.
 *
 * The trickier race is staleness of the "referenced" set itself: this job takes ONE
 * upfront read of asset_versions.r2_key, then walks a paginated R2 listing that can
 * take a while against a large bucket. A finalize call is under no time bound (only
 * the presigned PUT URL itself expires, after 5 minutes — nothing stops a caller from
 * PUTting bytes and calling finalize a day later), so it could legitimately commit its
 * D1 row AFTER that upfront snapshot but BEFORE this job's traversal reaches that
 * specific key — which, without more, would make a just-finalized object look orphaned
 * simply because the scan took a while. To close that window down to a single
 * check-then-delete pair (milliseconds) instead of the whole scan's duration, every
 * actual deletion candidate is re-verified against D1 fresh, immediately before it's
 * deleted — the age threshold's job is only to protect THIS narrower window, not the
 * whole run.
 *
 * "Referenced" means present in asset_versions.r2_key for ANY version, not just an
 * asset's current_version — old, superseded-but-still-served versions (and versions
 * of a soft-deleted asset — softDeleteAsset never touches R2) must never be deleted.
 *
 * RECONCILE_DRY_RUN defaults to true (log candidates, delete nothing) unless the env
 * var is literally the string "false" — unset/misconfigured must fail safe.
 */
export async function handleReconcile(env: Env): Promise<ReconcileResult> {
  const dryRun = env.RECONCILE_DRY_RUN !== 'false';

  const { results } = await env.MEDIA_DB.prepare('SELECT r2_key FROM asset_versions').all<{ r2_key: string }>();
  const referenced = new Set(results.map((r) => r.r2_key));

  const cutoff = Date.now() - ORPHAN_AGE_MS;
  let cursor: string | undefined;
  let candidates = 0;
  let deleted = 0;

  do {
    const page = await env.MEDIA_BUCKET.list({ cursor });
    for (const obj of page.objects) {
      if (referenced.has(obj.key)) continue; // known-referenced as of the snapshot above
      if (obj.uploaded.getTime() > cutoff) continue; // too young — might still be finalizing

      // The snapshot above can be stale by the time we reach this key — re-check fresh,
      // right before deleting, in case a finalize committed in the meantime.
      const nowReferenced = await env.MEDIA_DB.prepare('SELECT 1 FROM asset_versions WHERE r2_key = ? LIMIT 1')
        .bind(obj.key)
        .first();
      if (nowReferenced) continue;

      candidates++;
      if (!dryRun) {
        await env.MEDIA_BUCKET.delete(obj.key);
        deleted++;
      }
      console.log(`reconcile: orphan ${dryRun ? 'candidate' : 'deleted'} ${obj.key} (uploaded ${obj.uploaded.toISOString()})`);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  console.log(`reconcile: ${candidates} orphan candidate(s), ${deleted} deleted, dryRun=${dryRun}`);
  return { candidates, deleted, dryRun };
}
