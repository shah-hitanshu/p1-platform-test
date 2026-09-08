/**
 * POST /media/:assetId/purge — hard delete for legal takedowns (DMCA, illegal content,
 * PII/GDPR erasure). Deletes every version's bytes from R2, removes the D1 rows so
 * /image/* 404s, purges the edge cache by tag, and leaves an audit record.
 *
 * Operator-only: gated by the PURGE_ADMIN_TOKEN secret (purge-auth.ts), deliberately
 * NOT by the site-scoped bearer path — takedowns are operator/legal actions, and the
 * signature takes no siteId on purpose. The soft DELETE /media/:assetId stays the
 * normal, reversible path.
 *
 * The mainline in handlePurge IS the ordering contract; each step function's comment
 * carries the failure mode that puts it there. R2-before-D1 because the worst
 * intermediate state must be "row present, bytes gone" (already serves 404; a retry
 * cleans up), never "bytes present, rows gone" — that asset would keep serving while
 * invisible to every API, reachable only by the reconcile sweep, which runs in
 * permanent dry-run today.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../types';
import { authorizePurge } from '../purge-auth';
import { purgeAssetCache, type CachePurgeOutcome } from '../cache/purge';
import {
  completePurgeAudit,
  findCompletedPurge,
  getAssetSiteId,
  hardDeleteAssetRows,
  insertPurgeIntent,
  listAssetR2Keys,
} from '../purge-store';
import { readPurgeRequest, type PurgeRequestBody } from './purge-request';

export async function handlePurge(request: Request, env: Env, assetId: string): Promise<Response> {
  const denied = await requireOperatorToken(request, env, assetId);
  if (denied !== null) return denied;

  const parsed = await readPurgeRequest(request);
  if (!parsed.ok) {
    return json({ error: 'Invalid purge request', errors: parsed.errors }, 400);
  }

  const target = await resolveTarget(env, assetId);
  if (target instanceof Response) return target;

  const intent = await recordIntent(env, assetId, target, parsed.value);
  if (intent instanceof Response) return intent;

  return destroyAsset(env, intent);
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The token gate, before anything is read or written. 503 (not 401) when the secret
 * itself is unset, so an operator sees "misconfigured" rather than "wrong token" —
 * and never a success. Null means authorized.
 */
async function requireOperatorToken(
  request: Request,
  env: Env,
  assetId: string,
): Promise<Response | null> {
  const auth = await authorizePurge(request, env);
  if (auth === 'unconfigured') {
    getLogger().error('purge rejected: PURGE_ADMIN_TOKEN is not configured', undefined, {
      asset_id: assetId,
      outcome: 'fail_closed',
    });
    return json({ error: 'Purge not configured' }, 503);
  }
  if (auth === 'denied') return json({ error: 'Unauthorized' }, 401);
  return null;
}

interface PurgeTarget {
  siteId: string | null;
  keys: string[];
}

/**
 * Resolves what the purge must destroy. Both lookups tolerate soft-deleted assets —
 * a takedown after DELETE /media/:assetId is the expected sequence, not an edge case.
 * When nothing exists, a prior completed purge makes this an idempotent-retry 200;
 * no audit history makes it an unknown asset. That distinction only works because
 * purge_audit outlives the asset row.
 */
async function resolveTarget(env: Env, assetId: string): Promise<PurgeTarget | Response> {
  const siteId = await getAssetSiteId(env, assetId);
  const versions = await listAssetR2Keys(env, assetId);
  if (siteId !== null || versions.length > 0) {
    return { siteId, keys: versions.map((v) => v.r2Key) };
  }

  const prior = await findCompletedPurge(env, assetId);
  if (prior !== null) {
    // Re-attempt the tag purge on every retry: a completed purge can still have
    // failed its cache step, and without this a re-run would short-circuit here and
    // leave cached variants serving until TTL. The purge is idempotent and cheap, so
    // "re-run until clean" covers the cache too.
    const cachePurge =
      prior.siteId !== null ? await purgeAssetCache(prior.siteId, assetId) : 'skipped';
    return json(
      {
        purgeId: prior.purgeId,
        assetId,
        siteId: prior.siteId,
        status: 'completed',
        alreadyPurged: true,
        cachePurge,
      },
      200,
    );
  }
  getLogger().warn('purge requested for unknown asset', { asset_id: assetId, outcome: 'not_found' });
  return json({ error: 'Not found' }, 404);
}

interface PurgeExecution extends PurgeTarget {
  purgeId: string;
  assetId: string;
}

/**
 * The audit INTENT row, before any destruction: a crash mid-purge still leaves a
 * durable record of what was attempted, by whom, over which keys. If this insert
 * fails, destroy nothing — an unaudited takedown is worse than a retryable one.
 */
async function recordIntent(
  env: Env,
  assetId: string,
  target: PurgeTarget,
  body: PurgeRequestBody,
): Promise<PurgeExecution | Response> {
  const purgeId = crypto.randomUUID();
  try {
    await insertPurgeIntent(env, {
      purgeId,
      assetId,
      siteId: target.siteId,
      requestedById: body.requestedBy,
      requestedByType: body.requestedByType,
      reason: body.reason,
      r2Keys: target.keys,
      requestedAt: new Date().toISOString(),
    });
  } catch (error) {
    getLogger().error('purge aborted: audit intent row could not be written', error, {
      asset_id: assetId,
      outcome: 'aborted',
    });
    return json({ error: 'Audit record could not be written; nothing was purged' }, 500);
  }
  return { purgeId, assetId, ...target };
}

// R2's documented cap on keys per bulk delete call.
const R2_DELETE_CHUNK = 1000;

/** Deletes keys in chunks; a failing chunk is counted, not fatal — later chunks still run. */
async function deleteR2Keys(
  env: Env,
  keys: string[],
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < keys.length; i += R2_DELETE_CHUNK) {
    const chunk = keys.slice(i, i + R2_DELETE_CHUNK);
    try {
      // Idempotent: deleting an absent key succeeds, which is what makes retry safe.
      await env.MEDIA_BUCKET.delete(chunk);
      deleted += chunk.length;
    } catch (error) {
      getLogger().error('purge: R2 delete chunk failed', error, {
        outcome: 'partial',
        count: chunk.length,
      });
      failed += chunk.length;
    }
  }
  return { deleted, failed };
}

/**
 * The destructive sequence: bytes, then rows, then edge cache, then the audit
 * completion. If any R2 delete failed, the D1 rows are deliberately KEPT — they are
 * both the index of the surviving keys and the reconcile sweep's "referenced" set,
 * so dropping them would turn a retryable partial into an orphan. Partial answers
 * 500, not 207: no caller may read an incomplete takedown as done.
 */
async function destroyAsset(env: Env, execution: PurgeExecution): Promise<Response> {
  const { purgeId, assetId, siteId, keys } = execution;
  const logger = getLogger();

  const { deleted: r2Deleted, failed: r2Failed } = await deleteR2Keys(env, keys);

  const finish = async (
    status: 'completed' | 'partial',
    versionsDeleted: number,
    cachePurge: CachePurgeOutcome | null,
    error: string | null,
  ): Promise<void> => {
    try {
      await completePurgeAudit(env, purgeId, {
        status,
        r2Deleted,
        r2Failed,
        versionsDeleted,
        cachePurgeOutcome: cachePurge,
        error,
      });
    } catch (auditError) {
      // The intent row plus this log line are the record; still return the real outcome.
      logger.error('purge audit completion failed', auditError, {
        purge_id: purgeId,
        asset_id: assetId,
        outcome: status,
      });
    }
  };

  const partial = (error: string): Promise<Response> =>
    finish('partial', 0, null, error).then(() =>
      json(
        { purgeId, assetId, siteId, status: 'partial', r2Deleted, r2Failed, versionsDeleted: 0 },
        500,
      ),
    );

  if (r2Failed > 0) {
    return partial(`${String(r2Failed)} R2 deletes failed`);
  }

  let versionsDeleted: number;
  try {
    versionsDeleted = await hardDeleteAssetRows(env, assetId);
  } catch (error) {
    // Bytes are gone, so /image/* already 404s; the residual metadata rows are
    // cleaned up by retrying the same call.
    logger.error('purge: D1 row delete failed after R2 deletes succeeded', error, {
      purge_id: purgeId,
      asset_id: assetId,
      outcome: 'partial',
    });
    return partial('D1 hard delete failed');
  }

  // Edge cache last: after the destructive work has committed, so it can neither
  // abort a takedown nor re-cache still-live bytes. Never fails the request — the
  // outcome lands in the audit row and the response body instead.
  const cachePurge = siteId !== null ? await purgeAssetCache(siteId, assetId) : 'skipped';

  await finish('completed', versionsDeleted, cachePurge, null);

  logger.warn('asset hard-purged', {
    purge_id: purgeId,
    asset_id: assetId,
    site_id: siteId ?? undefined,
    count: r2Deleted,
    outcome: 'success',
  });

  return json(
    { purgeId, assetId, siteId, status: 'completed', r2Deleted, r2Failed: 0, versionsDeleted, cachePurge },
    200,
  );
}
