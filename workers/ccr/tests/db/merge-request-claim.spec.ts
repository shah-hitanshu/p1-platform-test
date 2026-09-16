/**
 * The MR execution claim against a real Postgres.
 *
 * `claimMergeRequestForExecution` runs two separate single-status UPDATEs
 * (approved, then conflicted) and reports whichever one matched. Whether the
 * second qual actually fires when the first one doesn't is a property of the
 * two statements running in sequence against one row — a stub keyed by
 * table+operation returns the same answer regardless of which qual is being
 * tried, so it can't tell these two cases apart.
 *
 * Prerequisites:
 * - PostgreSQL running: make docker-up
 * - Migrations applied: pnpm db:migrate
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type postgres from 'postgres';
import type { Database } from '../../src/db';
import { branches, mergeRequests, sites } from '../../src/db/schema';
import { claimMergeRequestForExecution, createMergeRequest } from '../../src/services/merge-request-service';
import type { MergeRequestStatus } from '../../src/types';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';

const AUTHOR = { createdById: randomUUID(), createdByType: 'user' as const };

let db: Database;
let sql: postgres.Sql;
let close: () => Promise<void>;
let siteIds: string[] = [];
let siteId: string;
let mainBranchId: string;
let featureBranchId: string;

async function createSite(): Promise<string> {
  const [row] = await db
    .insert(sites)
    .values({ name: `merge-claim-${randomUUID()}` })
    .returning({ id: sites.id });
  siteIds.push(row.id);
  return row.id;
}

async function createBranch(values: {
  name: string;
  isMain?: boolean;
  sourceBranchId?: string;
}): Promise<string> {
  const [row] = await db
    .insert(branches)
    .values({ siteId, ...AUTHOR, ...values })
    .returning({ id: branches.id });
  return row.id;
}

/** Creates a real MR against main, then forces it into `status` for the test. */
async function createMergeRequestWithStatus(status: MergeRequestStatus): Promise<string> {
  const mergeRequest = await createMergeRequest({
    siteId,
    sourceBranchId: featureBranchId,
    targetBranchId: mainBranchId,
    title: 'Test merge request',
    createdById: AUTHOR.createdById,
    createdByType: 'user',
  });
  await db.update(mergeRequests).set({ status }).where(eq(mergeRequests.id, mergeRequest.id));
  return mergeRequest.id;
}

async function statusOf(mergeRequestId: string): Promise<string> {
  const [row] = await db
    .select({ status: mergeRequests.status })
    .from(mergeRequests)
    .where(eq(mergeRequests.id, mergeRequestId));
  return row.status;
}

beforeAll(async () => {
  const handles = createRealDatabaseConnection();
  db = handles.db;
  sql = handles.sql;
  close = handles.close;
  await sql`SELECT 1`;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  siteId = await createSite();
  mainBranchId = await createBranch({ name: 'main', isMain: true });
  featureBranchId = await createBranch({ name: 'feature', sourceBranchId: mainBranchId });
});

afterEach(async () => {
  for (const id of [...siteIds].reverse()) {
    await deleteSiteCascade(sql, id);
  }
  siteIds = [];
});

describe('claimMergeRequestForExecution', () => {
  it('reports conflicted as the prior status via the second qual', async () => {
    const mergeRequestId = await createMergeRequestWithStatus('conflicted');

    const prior = await claimMergeRequestForExecution(mergeRequestId);

    expect(prior).toBe('conflicted');
    expect(await statusOf(mergeRequestId)).toBe('merging');
  });

  it('reports approved as the prior status via the first qual', async () => {
    const mergeRequestId = await createMergeRequestWithStatus('approved');

    const prior = await claimMergeRequestForExecution(mergeRequestId);

    expect(prior).toBe('approved');
    expect(await statusOf(mergeRequestId)).toBe('merging');
  });
});
