/**
 * Merge Job Runner - Integration Tests [PCC-3737]
 *
 * Drives the workflow's step bodies (services/merge-job-service.ts) directly
 * against real Postgres — the WorkflowEntrypoint is a thin shell by design, so
 * this is where resumability is proven.
 *
 * The load-bearing test is the incident regression: the 2026-08-20 Cellar Door
 * merge stalled because retries re-walked already-merged documents and
 * re-INSERTed full-snapshot duplicates (blind skipDuplicateCheck). Here a
 * replayed chunk — ledger rows forced back to pending, exactly what a step
 * retry or a fresh job after a crash sees — must produce ZERO additional
 * `source='merge'` versions. If anyone reintroduces blind-insert semantics,
 * these tests fail.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createBranch } from '../../src/services/branch-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { publishDocument } from '../../src/services/checkpoint-publish';
import {
  createMergeRequest,
  updateMergeRequestStatus,
  getMergeRequest,
} from '../../src/services/merge-request-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import {
  createMergeJob,
  planMergeJob,
  applyMergeChunk,
  finalizeMergeCheckpoint,
  finalizeMergeStatus,
  finalizeMergePublish,
  finalizeMergeJobRecord,
  cancelMergeJob,
  claimMergeRequestForExecution,
  requestMergeJobCancel,
  getMergeJob,
  getMergeJobProjection,
} from '../../src/services/merge-job-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'merge-job-runner-test';

describe('Merge Job Runner - Integration Tests [PCC-3737]', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'merge-job-runner@example.com', 'Merge Job Runner User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Merge Job Runner Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    const mainBranch = branches[0];
    if (mainBranch === undefined) {
      throw new Error('site created without a main branch');
    }
    mainBranchId = mainBranch.id as string;
  });

  afterAll(async () => {
    try {
      await deleteSiteCascade(sql, siteId);
      await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    } finally {
      await sql.end();
      setDatabaseInstance(null);
    }
  });

  async function createFeatureBranch(name: string): Promise<string> {
    const branch = await createBranch({
      name,
      siteId,
      sourceBranchId: mainBranchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return branch.id;
  }

  async function createDocOnBranch(branchId: string, path: string): Promise<string> {
    const { document } = await createDocumentOnBranch({
      siteId,
      branchId,
      path,
      snapshot: { root: { props: { title: `${path} v1` } } },
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return document.id;
  }

  async function createApprovedMergeRequest(sourceBranchId: string, title: string): Promise<string> {
    const mergeRequest = await createMergeRequest({
      siteId,
      sourceBranchId,
      targetBranchId: mainBranchId,
      title,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    await updateMergeRequestStatus(mergeRequest.id, 'approved');
    return mergeRequest.id;
  }

  async function startJob(mergeRequestId: string, sourceBranchId: string): Promise<string> {
    const priorStatus = await claimMergeRequestForExecution(mergeRequestId);
    expect(priorStatus).toBe('approved');
    const jobId = crypto.randomUUID();
    await createMergeJob({
      jobId,
      mergeRequestId,
      siteId,
      sourceBranchId,
      targetBranchId: mainBranchId,
      priorMrStatus: priorStatus as string,
      triggeredById: TEST_USER_ID,
      triggeredByType: 'user',
    });
    return jobId;
  }

  async function mergeVersionCount(documentId: string): Promise<number> {
    const rows = await sql`
      SELECT COUNT(*) AS count FROM app.document_versions
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId} AND source = 'merge'
    `;
    return parseInt(rows[0]?.count as string, 10);
  }

  it('runs a merge job end-to-end: plan, chunked apply, finalize, publish', async () => {
    const featureBranchId = await createFeatureBranch('runner-e2e');
    const docIds = [
      await createDocOnBranch(featureBranchId, 'pages/runner/one'),
      await createDocOnBranch(featureBranchId, 'pages/runner/two'),
      await createDocOnBranch(featureBranchId, 'pages/runner/three'),
    ];
    const mergeRequestId = await createApprovedMergeRequest(featureBranchId, 'runner e2e');
    const jobId = await startJob(mergeRequestId, featureBranchId);

    const plan = await planMergeJob(jobId);
    expect(plan).toEqual({
      outcome: 'planned',
      totalDocuments: 3,
      copyCount: 3,
      conflictCount: 0,
    });

    // Chunked: 2 then 1, exactly like the workflow's loop.
    const chunk1 = await applyMergeChunk(jobId, { chunkSize: 2 });
    expect(chunk1.done).toBe(2);
    expect(chunk1.remaining).toBe(1);

    const chunk2 = await applyMergeChunk(jobId, { chunkSize: 2 });
    expect(chunk2.done).toBe(1);
    expect(chunk2.remaining).toBe(0);

    // An extra chunk call (idle step retry) finds nothing to do.
    const chunk3 = await applyMergeChunk(jobId, { chunkSize: 2 });
    expect(chunk3).toMatchObject({ done: 0, failed: 0, noop: 0, remaining: 0 });

    const checkpoint = await finalizeMergeCheckpoint(jobId);
    expect(checkpoint.finalized).toBe(true);
    expect(checkpoint.checkpointId).not.toBeNull();
    expect(checkpoint.mergedCount).toBe(3);

    const status = await finalizeMergeStatus(jobId);
    expect(status.finalized).toBe(true);
    expect((await getMergeRequest(mergeRequestId))?.status).toBe('merged');

    const publish = await finalizeMergePublish(jobId);
    expect(publish.targetIsMain).toBe(true);
    expect(publish.publishError).toBeNull();
    expect(publish.publishCheckpointId).not.toBeNull();
    expect(publish.publishedDocumentIds.sort()).toEqual([...docIds].sort());

    const finalStatus = await finalizeMergeJobRecord(jobId);
    expect(finalStatus).toBe('completed');

    // Exactly one merge version per document — the whole point.
    for (const docId of docIds) {
      expect(await mergeVersionCount(docId)).toBe(1);
    }

    // Finalization stamps make re-runs (crash between commit and step
    // persistence) free: same ids come back, nothing new is created.
    const checkpointAgain = await finalizeMergeCheckpoint(jobId);
    expect(checkpointAgain.checkpointId).toBe(checkpoint.checkpointId);
    const publishAgain = await finalizeMergePublish(jobId);
    expect(publishAgain.publishCheckpointId).toBe(publish.publishCheckpointId);
  });

  it('INCIDENT REGRESSION: a replayed chunk creates zero duplicate versions', async () => {
    const featureBranchId = await createFeatureBranch('runner-replay');
    const docIds = [
      await createDocOnBranch(featureBranchId, 'pages/replay/one'),
      await createDocOnBranch(featureBranchId, 'pages/replay/two'),
    ];
    const mergeRequestId = await createApprovedMergeRequest(featureBranchId, 'runner replay');
    const jobId = await startJob(mergeRequestId, featureBranchId);

    await planMergeJob(jobId);
    const first = await applyMergeChunk(jobId);
    expect(first.done).toBe(2);

    // Simulate the crash window / step retry the incident exposed: the
    // versions are committed but the ledger says pending again. The old
    // inline path re-INSERTed a full-snapshot duplicate per document here
    // (verified in prod: 5 duplicates per sampled doc, ~600 junk rows).
    await sql`
      UPDATE app.merge_job_documents
      SET status = 'pending', result_version_id = NULL
      WHERE job_id = ${jobId}
    `;

    const replay = await applyMergeChunk(jobId);
    // The write-level probe recognizes each planned write as already applied.
    expect(replay.done).toBe(2);
    expect(replay.remaining).toBe(0);

    for (const docId of docIds) {
      expect(await mergeVersionCount(docId)).toBe(1);
    }
  });

  it('resumes across jobs: a fresh job after a failure skips already-merged documents', async () => {
    const featureBranchId = await createFeatureBranch('runner-cross-job');
    const docId = await createDocOnBranch(featureBranchId, 'pages/crossjob/one');
    const mergeRequestId = await createApprovedMergeRequest(featureBranchId, 'runner cross-job');

    // First job copies the document, then dies before finalization.
    const firstJobId = await startJob(mergeRequestId, featureBranchId);
    await planMergeJob(firstJobId);
    await applyMergeChunk(firstJobId);
    await sql`
      UPDATE app.merge_jobs SET status = 'failed', finished_at = NOW() WHERE id = ${firstJobId}
    `;
    await sql`
      UPDATE app.merge_requests SET status = 'approved' WHERE id = ${mergeRequestId}
    `;

    // A brand-new execute: new job, fresh plan over the same source state.
    const secondJobId = await startJob(mergeRequestId, featureBranchId);
    await planMergeJob(secondJobId);
    const chunk = await applyMergeChunk(secondJobId);

    // Layer 2 catches it: the latest main version already carries
    // source='merge' from this exact source version.
    expect(chunk.done).toBe(1);
    expect(await mergeVersionCount(docId)).toBe(1);

    await finalizeMergeCheckpoint(secondJobId);
    await finalizeMergeStatus(secondJobId);
    expect((await getMergeRequest(mergeRequestId))?.status).toBe('merged');
    await finalizeMergeJobRecord(secondJobId);
  });

  it('blocks on conflicts at plan time and returns the MR to conflicted', async () => {
    const featureBranchId = await createFeatureBranch('runner-conflict');
    const docId = await createDocOnBranch(mainBranchId, 'pages/conflict/shared');

    // Same document edited on both branches after the branch point → conflict.
    await createDocumentVersion({
      documentId: docId,
      branchId: featureBranchId,
      snapshot: { root: { props: { title: 'feature edit' } } },
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    await createDocumentVersion({
      documentId: docId,
      branchId: mainBranchId,
      snapshot: { root: { props: { title: 'main edit' } } },
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    // The target side of conflict detection only sees checkpointed versions;
    // publish makes the main-side edit count.
    await publishDocument({
      siteId,
      documentId: docId,
      branchId: mainBranchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const mergeRequestId = await createApprovedMergeRequest(featureBranchId, 'runner conflict');
    const jobId = await startJob(mergeRequestId, featureBranchId);

    const plan = await planMergeJob(jobId);
    expect(plan.outcome).toBe('blocked_on_conflicts');

    const job = await getMergeJob(jobId);
    expect(job?.status).toBe('blocked_on_conflicts');
    expect((await getMergeRequest(mergeRequestId))?.status).toBe('conflicted');
  });

  it('cancels cooperatively between chunks and restores the MR', async () => {
    const featureBranchId = await createFeatureBranch('runner-cancel');
    await createDocOnBranch(featureBranchId, 'pages/cancel/one');
    await createDocOnBranch(featureBranchId, 'pages/cancel/two');
    const mergeRequestId = await createApprovedMergeRequest(featureBranchId, 'runner cancel');
    const jobId = await startJob(mergeRequestId, featureBranchId);

    await planMergeJob(jobId);
    const firstChunk = await applyMergeChunk(jobId, { chunkSize: 1 });
    expect(firstChunk.done).toBe(1);

    const requested = await requestMergeJobCancel(jobId, siteId);
    expect(requested).toBe(true);

    // The next chunk observes the flag and does no work.
    const cancelledChunk = await applyMergeChunk(jobId);
    expect(cancelledChunk.cancelled).toBe(true);

    await cancelMergeJob(jobId);
    expect((await getMergeJob(jobId))?.status).toBe('cancelled');
    // MR restored so the merge can be re-executed later; partial copies stay
    // recorded in the ledger (unpublished — invisible on the live site).
    expect((await getMergeRequest(mergeRequestId))?.status).toBe('approved');

    const projection = await getMergeJobProjection(jobId, siteId);
    expect(projection?.processedDocuments).toBe(1);
  });

  it('INCIDENT REGRESSION (take-source): a replayed conflict row stays done — never dropped from publish', async () => {
    const featureBranchId = await createFeatureBranch('runner-takesrc-replay');
    // Same doc changed on both branches -> conflict; resolved take-source.
    const docId = await createDocOnBranch(mainBranchId, 'pages/takesrc/shared');
    await createDocumentVersion({
      documentId: docId,
      branchId: featureBranchId,
      snapshot: { root: { props: { title: 'feature wins' } } },
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    await createDocumentVersion({
      documentId: docId,
      branchId: mainBranchId,
      snapshot: { root: { props: { title: 'main edit' } } },
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    await publishDocument({
      siteId, documentId: docId, branchId: mainBranchId,
      createdById: TEST_USER_ID, createdByType: 'user',
    });

    const mergeRequestId = await createApprovedMergeRequest(featureBranchId, 'takesrc replay');
    const priorStatus = await claimMergeRequestForExecution(mergeRequestId);
    expect(priorStatus).toBe('approved');
    const jobId = crypto.randomUUID();
    await createMergeJob({
      jobId, mergeRequestId, siteId,
      sourceBranchId: featureBranchId, targetBranchId: mainBranchId,
      priorMrStatus: 'approved',
      resolutionStrategy: 'take-source',
      triggeredById: TEST_USER_ID, triggeredByType: 'user',
    });

    const plan = await planMergeJob(jobId);
    expect(plan.outcome).toBe('planned');

    const first = await applyMergeChunk(jobId);
    expect(first.done).toBeGreaterThanOrEqual(1);
    const mergeCountAfterFirst = await mergeVersionCount(docId);
    expect(mergeCountAfterFirst).toBe(1);

    // Crash-window replay: the take-source version is committed but the
    // ledger says pending. Pre-fix, the replay's create returned the
    // already-committed version, the pre-existing check misclassified it
    // skipped_noop, and the document was silently DROPPED from the
    // checkpoint and publish while the job reported completed.
    await sql`
      UPDATE app.merge_job_documents
      SET status = 'pending', result_version_id = NULL
      WHERE job_id = ${jobId} AND document_id = ${docId}
    `;
    const replay = await applyMergeChunk(jobId);
    expect(replay.done).toBeGreaterThanOrEqual(1);
    expect(replay.noop).toBe(0);
    expect(await mergeVersionCount(docId)).toBe(1);

    const ledgerRow = await sql`
      SELECT status, result_version_id FROM app.merge_job_documents
      WHERE job_id = ${jobId} AND document_id = ${docId}
    `;
    expect(ledgerRow[0]?.status).toBe('done');
    expect(ledgerRow[0]?.result_version_id).not.toBeNull();

    // And the finalized checkpoint must include the conflict-resolved doc.
    const checkpoint = await finalizeMergeCheckpoint(jobId);
    expect(checkpoint.finalized).toBe(true);
    const captured = await sql`
      SELECT 1 FROM app.checkpoint_documents
      WHERE checkpoint_id = ${checkpoint.checkpointId} AND document_id = ${docId}
    `;
    expect(captured.length).toBe(1);
    await finalizeMergeStatus(jobId);
    await finalizeMergeJobRecord(jobId);
  });

  it('records a poison document without aborting and withholds finalization (all-or-nothing)', async () => {
    const featureBranchId = await createFeatureBranch('runner-poison');
    await createDocOnBranch(featureBranchId, 'pages/poison/doc-1');
    await createDocOnBranch(featureBranchId, 'pages/poison/doc-2');
    await createDocOnBranch(featureBranchId, 'pages/poison/doc-3');
    const mergeRequestId = await createApprovedMergeRequest(featureBranchId, 'runner poison');
    const jobId = await startJob(mergeRequestId, featureBranchId);

    await planMergeJob(jobId);

    // Poison: delete one frozen source version between plan and apply — the
    // planned write for that document can no longer be performed.
    const victim = await sql`
      SELECT document_id, source_version_id FROM app.merge_job_documents
      WHERE job_id = ${jobId} ORDER BY document_path LIMIT 1
    `;
    await sql`DELETE FROM app.document_versions WHERE id = ${victim[0]?.source_version_id as string}`;

    // The chunk records the failure and keeps going — a poison document must
    // never abort the job (the incident's stalls were whole-job, not per-doc).
    const chunk = await applyMergeChunk(jobId);
    expect(chunk.done).toBe(2);
    expect(chunk.failed).toBe(1);
    expect(chunk.remaining).toBe(0);

    // All-or-nothing finalization: no checkpoint, no status flip, no publish.
    const checkpoint = await finalizeMergeCheckpoint(jobId);
    expect(checkpoint.finalized).toBe(false);
    expect(checkpoint.checkpointId).toBeNull();
    const status = await finalizeMergeStatus(jobId);
    expect(status.finalized).toBe(false);
    expect(await finalizeMergeJobRecord(jobId)).toBe('completed_with_errors');

    // The MR is restored so the merge can be fixed and re-executed…
    expect((await getMergeRequest(mergeRequestId))?.status).toBe('approved');
    // …and the status projection names exactly what failed and why.
    const projection = await getMergeJobProjection(jobId, siteId);
    expect(projection?.failedDocumentDetails).toEqual([
      expect.objectContaining({
        documentId: victim[0]?.document_id,
        error: 'source version no longer exists',
      }),
    ]);
  });

  it('serializes concurrent execute triggers via the MR status CAS', async () => {
    const featureBranchId = await createFeatureBranch('runner-serialize');
    await createDocOnBranch(featureBranchId, 'pages/serialize/one');
    const mergeRequestId = await createApprovedMergeRequest(featureBranchId, 'runner serialize');

    const winner = await claimMergeRequestForExecution(mergeRequestId);
    expect(winner).toBe('approved');

    // The loser of the race gets no claim.
    const loser = await claimMergeRequestForExecution(mergeRequestId);
    expect(loser).toBeNull();
  });
});
