/**
 * Failure drill [PCC-3737]: poison document.
 *
 * Plans a job, then deletes one frozen source version out from under it —
 * the apply must record that one document as failed WITHOUT aborting the
 * job, and finalization must withhold checkpoint/status/publish
 * (all-or-nothing), ending the job completed_with_errors with the MR
 * restored. Local drill only.
 */

import '../src/db/node-esm-compat';

const { runWithConnection, query } = await import('../src/db');
const {
  createMergeJob, claimMergeRequestForExecution, planMergeJob, applyMergeChunk,
  finalizeMergeCheckpoint, finalizeMergeStatus, finalizeMergeJobRecord,
} = await import('../src/services/merge-job-service');

const [siteId, mergeRequestId, sourceBranchId, targetBranchId] = process.argv.slice(2);
if (
  siteId === undefined || siteId === '' ||
  mergeRequestId === undefined || mergeRequestId === '' ||
  sourceBranchId === undefined || sourceBranchId === '' ||
  targetBranchId === undefined || targetBranchId === ''
) {
  throw new Error('usage: drill-poison.ts <siteId> <mrId> <sourceBranchId> <targetBranchId>');
}

const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ?? 'postgresql://cssuser:csspass@localhost:5432/cssdb';

await runWithConnection(DATABASE_URL, { isHyperdrive: false }, async () => {
  const prior = await claimMergeRequestForExecution(mergeRequestId);
  console.log('claimed MR, prior status:', prior);

  const jobId = crypto.randomUUID();
  await createMergeJob({
    jobId, mergeRequestId, siteId, sourceBranchId, targetBranchId,
    priorMrStatus: prior ?? 'approved',
    triggeredById: ALICE_ID, triggeredByType: 'user',
  });

  const plan = await planMergeJob(jobId);
  console.log('plan:', JSON.stringify(plan));

  // Poison: delete ONE frozen source version between plan and apply.
  const victim = await query<{ document_path: string; source_version_id: string }>(
    `SELECT document_path, source_version_id FROM app.merge_job_documents
     WHERE job_id = $1 ORDER BY document_path LIMIT 1`,
    [jobId],
  );
  const row = victim.rows[0];
  if (row === undefined) throw new Error('no ledger rows');
  await query('DELETE FROM app.document_versions WHERE id = $1', [row.source_version_id]);
  console.log('poisoned:', row.document_path, '(deleted its frozen source version)');

  let chunk;
  do {
    chunk = await applyMergeChunk(jobId);
    console.log('chunk:', JSON.stringify(chunk));
  } while (chunk.remaining > 0 && !chunk.cancelled);

  const checkpoint = await finalizeMergeCheckpoint(jobId);
  console.log('finalize-checkpoint:', JSON.stringify(checkpoint));
  const status = await finalizeMergeStatus(jobId);
  console.log('finalize-status:', JSON.stringify(status));
  const final = await finalizeMergeJobRecord(jobId);
  console.log('finalize-job:', final);
  console.log('jobId:', jobId);
});
