/**
 * Repair: rebuild version-history snapshots from the successor's patch.
 *
 * Compaction used to null a version's snapshot without checking whether that
 * row carried a patch of its own, leaving rows with neither. Forward replay
 * cannot rebuild them — that is what published-snapshot-repair reports as
 * unrecoverable — but the version immediately above often holds both a full
 * snapshot and the forward diff from the damaged row, so the damaged content
 * is the successor's snapshot with that diff undone.
 *
 * Only add-only diffs invert: RFC 6902 `remove` and `replace` record no prior
 * value. Every candidate is verified by re-applying the forward diff to the
 * rebuilt snapshot and comparing against the successor, so a row is written
 * only when the round trip reproduces the successor exactly.
 *
 * Writes go out in batches: a single-row UPDATE costs a round trip, and at
 * cross-region latency the run is bound by that rather than by the database.
 * A batch that fails is retried row by row, so one locked row costs its own
 * write and not its neighbours'.
 */

import { and, asc, eq, isNull, notLike, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { documentVersions, documents } from '../db/schema';
import { db } from '../db/scope';
import { applyPatch } from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';

const BATCH_SIZE = 250;

/**
 * Editing traffic holds row locks on the versions this repair targets. Failing
 * fast turns a contended row into one skip rather than a stalled run.
 */
const LOCK_TIMEOUT = '3s';

export interface RepairEntry {
  versionId: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  siteId: string;
  path: string;
}

export interface SkippedEntry extends RepairEntry {
  reason: string;
}

interface VersionHistoryRepairResult {
  repaired: RepairEntry[];
  nonInvertible: SkippedEntry[];
  chainBlocked: SkippedEntry[];
  writeFailed: SkippedEntry[];
  /**
   * Rows written one statement at a time after their batch was rejected. A run
   * that silently degrades to this finishes with the same rows repaired but
   * takes a round trip each, so it is reported rather than absorbed.
   */
  fallbackRows: number;
}

interface StrippedRow extends RepairEntry {
  successorSnapshot: Record<string, unknown> | null;
  successorPatch: unknown;
}

interface PendingWrite {
  entry: RepairEntry;
  snapshot: Record<string, unknown>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a !== 'object') return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  if (aKeys.length !== Object.keys(bObj).length) return false;
  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}

/**
 * Patches reach this table double-encoded on some write paths — a jsonb string
 * holding the JSON array rather than a jsonb array. The SELECT unwraps that
 * form; this covers a driver that still hands back a string.
 */
function parseOperations(patch: unknown): Operation[] | null {
  const value = typeof patch === 'string' ? JSON.parse(patch) as unknown : patch;
  if (!Array.isArray(value) || value.length === 0) return null;
  return value as Operation[];
}

/**
 * Inverts an add-only diff. Adds are undone newest-first so earlier paths still
 * point at the members they named when the diff was computed.
 */
function invert(ops: Operation[]): Operation[] | null {
  const inverted: Operation[] = [];
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    if (op?.op !== 'add') return null;
    // An append has no index to remove; the value it added is unaddressable.
    if (op.path.endsWith('/-')) return null;
    inverted.push({ op: 'remove', path: op.path });
  }
  return inverted;
}

async function writeBatch(
  pending: PendingWrite[],
): Promise<{ written: RepairEntry[]; failed: SkippedEntry[]; fallbackRows: number }> {
  if (pending.length === 0) return { written: [], failed: [], fallbackRows: 0 };

  const payload = JSON.stringify(
    pending.map(({ entry, snapshot }) => ({ id: entry.versionId, snapshot })),
  );

  try {
    // A bulk UPDATE...FROM sourced from jsonb_to_recordset() has no builder
    // equivalent, so this stays a raw statement (D6). The driver binds a
    // string parameter as a JSON string, so a bare ::jsonb cast yields a
    // scalar and jsonb_to_recordset rejects it; going through ::text parses
    // the payload as the array it is.
    await db().execute(sql`
      UPDATE app.document_versions dv
      SET snapshot = u.snapshot
      FROM jsonb_to_recordset(${payload}::text::jsonb) AS u(id uuid, snapshot jsonb)
      WHERE dv.id = u.id AND dv.snapshot IS NULL AND dv.patch IS NULL`);
    return { written: pending.map(({ entry }) => entry), failed: [], fallbackRows: 0 };
  } catch {
    const written: RepairEntry[] = [];
    const failed: SkippedEntry[] = [];
    for (const { entry, snapshot } of pending) {
      try {
        // The guard keeps a concurrent write's snapshot: a row that gained
        // content since the SELECT is no longer this repair's to fill.
        await db()
          .update(documentVersions)
          .set({ snapshot })
          .where(
            and(
              eq(documentVersions.id, entry.versionId),
              isNull(documentVersions.snapshot),
              isNull(documentVersions.patch),
            ),
          );
        written.push(entry);
      } catch (error) {
        failed.push({ ...entry, reason: `write failed: ${messageOf(error)}` });
      }
    }
    return { written, failed, fallbackRows: pending.length };
  }
}

/**
 * Finds versions holding neither a snapshot nor a patch and rebuilds each from
 * the version above it. Only ever fills NULL snapshots, so it is safe to re-run.
 *
 * Pass siteId to scope the run to one site, limit to cap how many rows one run
 * touches, and skipRegistry to leave `_registry/*` documents alone.
 */
export async function repairVersionHistorySnapshots(
  options: { dryRun: boolean; siteId?: string; limit?: number; skipRegistry?: boolean },
): Promise<VersionHistoryRepairResult> {
  const successor = alias(documentVersions, 'n');

  const conditions = [
    isNull(documentVersions.snapshot),
    isNull(documentVersions.patch),
    eq(documentVersions.isTombstone, false),
  ];
  if (options.siteId !== undefined) {
    conditions.push(eq(documents.siteId, options.siteId));
  }
  if (options.skipRegistry === true) {
    conditions.push(notLike(documents.path, '\\_registry/%'));
  }

  const strippedQuery = db()
    .select({
      versionId: documentVersions.id,
      documentId: documentVersions.documentId,
      branchId: documentVersions.branchId,
      versionNumber: documentVersions.versionNumber,
      siteId: documents.siteId,
      path: documents.path,
      successorSnapshot: successor.snapshot,
      successorPatch: sql<unknown>`CASE WHEN jsonb_typeof(${successor.patch}) = 'string'
                 THEN (${successor.patch} #>> '{}')::jsonb
                 ELSE ${successor.patch}
            END`,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .leftJoin(
      successor,
      and(
        eq(successor.documentId, documentVersions.documentId),
        eq(successor.branchId, documentVersions.branchId),
        eq(successor.versionNumber, sql`${documentVersions.versionNumber} + 1`),
      ),
    )
    .where(and(...conditions))
    .orderBy(
      asc(documents.siteId),
      asc(documentVersions.documentId),
      asc(documentVersions.branchId),
      asc(documentVersions.versionNumber),
    );

  // successorSnapshot/successorPatch are jsonb columns Drizzle can only type as
  // unknown without a schema-level $type() annotation; StrippedRow states the
  // shape this repair actually relies on.
  const stripped = (options.limit !== undefined
    ? await strippedQuery.limit(options.limit)
    : await strippedQuery) as StrippedRow[];

  const result: VersionHistoryRepairResult = {
    repaired: [],
    nonInvertible: [],
    chainBlocked: [],
    writeFailed: [],
    fallbackRows: 0,
  };

  if (!options.dryRun) {
    // SET does not accept a bind parameter, and LOCK_TIMEOUT is a fixed
    // in-module constant rather than request input.
    await db().execute(sql.raw(`SET lock_timeout = '${LOCK_TIMEOUT}'`));
  }

  let pending: PendingWrite[] = [];

  const flush = async (): Promise<void> => {
    const { written, failed, fallbackRows } = await writeBatch(pending);
    result.repaired.push(...written);
    result.writeFailed.push(...failed);
    result.fallbackRows += fallbackRows;
    pending = [];
  };

  for (const row of stripped) {
    const entry: RepairEntry = {
      versionId: row.versionId,
      documentId: row.documentId,
      branchId: row.branchId,
      versionNumber: row.versionNumber,
      siteId: row.siteId,
      path: row.path,
    };

    if (row.successorSnapshot === null) {
      result.chainBlocked.push({
        ...entry,
        reason: 'the version above holds no snapshot to rebuild from',
      });
      continue;
    }

    const ops = parseOperations(row.successorPatch);
    if (ops === null) {
      result.chainBlocked.push({
        ...entry,
        reason: 'the version above holds no forward diff from this version',
      });
      continue;
    }

    const inverted = invert(ops);
    if (inverted === null) {
      result.nonInvertible.push({
        ...entry,
        reason: 'the forward diff removes or replaces values, which record no prior state',
      });
      continue;
    }

    let rebuilt: Record<string, unknown>;
    try {
      rebuilt = applyPatch(
        structuredClone(row.successorSnapshot),
        inverted,
        false,
        false,
      ).newDocument;
      const roundTrip = applyPatch(structuredClone(rebuilt), ops, false, false).newDocument;
      if (!deepEqual(roundTrip, row.successorSnapshot)) {
        result.nonInvertible.push({
          ...entry,
          reason: 're-applying the forward diff did not reproduce the version above',
        });
        continue;
      }
    } catch (error) {
      result.nonInvertible.push({
        ...entry,
        reason: `inversion failed: ${messageOf(error)}`,
      });
      continue;
    }

    if (options.dryRun) {
      result.repaired.push(entry);
      continue;
    }

    pending.push({ entry, snapshot: rebuilt });
    if (pending.length >= BATCH_SIZE) {
      await flush();
    }
  }

  if (!options.dryRun) {
    await flush();
  }

  return result;
}
