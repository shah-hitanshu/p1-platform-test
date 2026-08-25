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

import { query } from '../db';
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

interface StrippedRow {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  site_id: string;
  path: string;
  successor_snapshot: Record<string, unknown> | null;
  successor_patch: unknown;
}

interface PendingWrite {
  entry: RepairEntry;
  snapshot: Record<string, unknown>;
}

// The driver binds a string parameter as a JSON string, so a bare ::jsonb cast
// yields a scalar and jsonb_to_recordset rejects it. Going through ::text
// parses the payload as the array it is.
const BATCH_UPDATE = `
  UPDATE app.document_versions dv
  SET snapshot = u.snapshot
  FROM jsonb_to_recordset($1::text::jsonb) AS u(id uuid, snapshot jsonb)
  WHERE dv.id = u.id AND dv.snapshot IS NULL AND dv.patch IS NULL`;

// The guard keeps a concurrent write's snapshot: a row that gained content
// since the SELECT is no longer this repair's to fill.
const SINGLE_UPDATE = `
  UPDATE app.document_versions
  SET snapshot = $1
  WHERE id = $2 AND snapshot IS NULL AND patch IS NULL`;

function toEntry(row: StrippedRow): RepairEntry {
  return {
    versionId: row.id,
    documentId: row.document_id,
    branchId: row.branch_id,
    versionNumber: row.version_number,
    siteId: row.site_id,
    path: row.path,
  };
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
    await query(BATCH_UPDATE, [payload]);
    return { written: pending.map(({ entry }) => entry), failed: [], fallbackRows: 0 };
  } catch {
    const written: RepairEntry[] = [];
    const failed: SkippedEntry[] = [];
    for (const { entry, snapshot } of pending) {
      try {
        await query(SINGLE_UPDATE, [snapshot, entry.versionId]);
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
  const params: unknown[] = [];
  const siteFilter = options.siteId !== undefined
    ? `AND d.site_id = $${String(params.push(options.siteId))}`
    : '';
  const registryFilter = options.skipRegistry === true
    ? "AND d.path NOT LIKE '\\_registry/%'"
    : '';
  const limitClause = options.limit !== undefined
    ? `LIMIT $${String(params.push(options.limit))}`
    : '';

  const stripped = await query<StrippedRow>(
    `SELECT v.id, v.document_id, v.branch_id, v.version_number,
            d.site_id, d.path,
            n.snapshot AS successor_snapshot,
            CASE WHEN jsonb_typeof(n.patch) = 'string'
                 THEN (n.patch #>> '{}')::jsonb
                 ELSE n.patch
            END AS successor_patch
     FROM app.document_versions v
     JOIN app.documents d ON d.id = v.document_id
     LEFT JOIN app.document_versions n
       ON n.document_id = v.document_id
      AND n.branch_id = v.branch_id
      AND n.version_number = v.version_number + 1
     WHERE v.snapshot IS NULL
       AND v.patch IS NULL
       AND v.is_tombstone = false
       ${siteFilter}
       ${registryFilter}
     ORDER BY d.site_id, v.document_id, v.branch_id, v.version_number
     ${limitClause}`,
    params,
  );

  const result: VersionHistoryRepairResult = {
    repaired: [],
    nonInvertible: [],
    chainBlocked: [],
    writeFailed: [],
    fallbackRows: 0,
  };

  if (!options.dryRun) {
    await query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
  }

  let pending: PendingWrite[] = [];

  const flush = async (): Promise<void> => {
    const { written, failed, fallbackRows } = await writeBatch(pending);
    result.repaired.push(...written);
    result.writeFailed.push(...failed);
    result.fallbackRows += fallbackRows;
    pending = [];
  };

  for (const row of stripped.rows) {
    const entry = toEntry(row);

    if (row.successor_snapshot === null) {
      result.chainBlocked.push({
        ...entry,
        reason: 'the version above holds no snapshot to rebuild from',
      });
      continue;
    }

    const ops = parseOperations(row.successor_patch);
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
        structuredClone(row.successor_snapshot),
        inverted,
        false,
        false,
      ).newDocument;
      const roundTrip = applyPatch(structuredClone(rebuilt), ops, false, false).newDocument;
      if (!deepEqual(roundTrip, row.successor_snapshot)) {
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
