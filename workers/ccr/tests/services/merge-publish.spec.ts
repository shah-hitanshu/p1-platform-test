/**
 * Merge Publish Helper Tests (TDD - Red State)
 *
 * Tests for `publishMergedVersions()` — the helper that turns a successful
 * merge-into-main into a publish event by:
 *   1. Setting publish provenance fields on each main-side merge version
 *      (source_branch_id, source_version_id) and the back-link
 *      (published_to_version_id) on the corresponding source-branch version.
 *   2. Creating a `publish` checkpoint on main referencing only the
 *      merge-touched documents (allowlist semantics).
 *
 * Safety constraint: only versions explicitly passed in via mergedVersions
 * may be touched. Other versions on main (e.g. unpublished edits) must
 * remain untouched.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentVersions } from '../../src/db/schema';
import { publishMergedVersions } from '../../src/services/merge-publish';
import { createCheckpoint } from '../../src/services/checkpoint-service';

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
}));

function checkpointResult(id: string, documentCount: number) {
  return {
    checkpoint: {
      id,
      branchId: 'main-branch',
      name: 'Auto-publish',
      checkpointType: 'publish' as const,
      createdAt: '2026-04-25T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user' as const,
    },
    documentCount,
  };
}

describe('publishMergedVersions', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
  });

  it('creates the publish checkpoint on main BEFORE writing any provenance UPDATE', async () => {
    // Ordering matters: createCheckpoint runs in its own transaction. If it
    // fails we must leave NO provenance behind (so isPublished stays false
    // and the document stays in its pre-merge state). The helper achieves
    // this by calling createCheckpoint first, then doing UPDATEs.
    const { statements, calls } = database;

    let statementsBeforeCheckpoint = -1;
    vi.mocked(createCheckpoint).mockImplementationOnce(() => {
      statementsBeforeCheckpoint = statements.length;
      return Promise.resolve(checkpointResult('checkpoint-publish-merge-1', 1));
    });

    const result = await publishMergedVersions({
      siteId: 'site-1',
      mainBranchId: 'main-branch',
      sourceBranchId: 'source-branch',
      mergedVersions: [
        {
          documentId: 'doc-1',
          documentVersionId: 'main-v-1',
          sourceVersionId: 'source-v-1',
        },
      ],
      mergedById: 'user-1',
      mergedByType: 'user',
      mergeTitle: 'Feature merge',
    });

    // Publish checkpoint created on main with documentVersionIds allowlist
    expect(createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'main-branch',
        checkpointType: 'publish',
        documentVersionIds: [
          { documentId: 'doc-1', documentVersionId: 'main-v-1' },
        ],
      }),
    );

    // Nothing has been written when the checkpoint is created; the two
    // provenance UPDATEs follow it.
    expect(statementsBeforeCheckpoint).toBe(0);
    expect(calls(documentVersions).update).toHaveLength(2);

    expect(result.checkpointId).toBe('checkpoint-publish-merge-1');
    expect(result.publishedCount).toBe(1);
  });

  it('sets source_branch_id and source_version_id on the main-side version when sourceVersionId is set', async () => {
    const { calls } = database;
    vi.mocked(createCheckpoint).mockResolvedValueOnce(checkpointResult('cp-1', 1));

    await publishMergedVersions({
      siteId: 'site-1',
      mainBranchId: 'main-branch',
      sourceBranchId: 'source-branch',
      mergedVersions: [
        {
          documentId: 'doc-1',
          documentVersionId: 'main-v-1',
          sourceVersionId: 'source-v-1',
        },
      ],
      mergedById: 'user-1',
      mergedByType: 'user',
      mergeTitle: 'Feature',
    });

    // The provenance UPDATE names the source branch and version it came from,
    // and the main-side version it describes.
    expect(calls(documentVersions).update.map((call) => call.params)).toContainEqual([
      'source-branch',
      'source-v-1',
      'main-v-1',
    ]);
  });

  it('sets published_to_version_id back-link on the source-branch version when sourceVersionId is set', async () => {
    const { calls } = database;
    vi.mocked(createCheckpoint).mockResolvedValueOnce(checkpointResult('cp-1', 1));

    await publishMergedVersions({
      siteId: 'site-1',
      mainBranchId: 'main-branch',
      sourceBranchId: 'source-branch',
      mergedVersions: [
        {
          documentId: 'doc-1',
          documentVersionId: 'main-v-1',
          sourceVersionId: 'source-v-1',
        },
      ],
      mergedById: 'user-1',
      mergedByType: 'user',
      mergeTitle: 'Feature',
    });

    // The back-link UPDATE points the source-branch version at the main-side one.
    expect(calls(documentVersions).update.map((call) => call.params)).toContainEqual([
      'main-v-1',
      'source-v-1',
    ]);
  });

  it('skips provenance updates for entries with sourceVersionId === null but still includes them in publish checkpoint', async () => {
    const { calls } = database;
    vi.mocked(createCheckpoint).mockResolvedValueOnce(checkpointResult('cp-1', 2));

    await publishMergedVersions({
      siteId: 'site-1',
      mainBranchId: 'main-branch',
      sourceBranchId: 'source-branch',
      mergedVersions: [
        // take-source resolution: has sourceVersionId
        {
          documentId: 'doc-1',
          documentVersionId: 'main-v-1',
          sourceVersionId: 'source-v-1',
        },
        // take-target / manual resolution: no clean source
        {
          documentId: 'doc-2',
          documentVersionId: 'main-v-2',
          sourceVersionId: null,
        },
      ],
      mergedById: 'user-1',
      mergedByType: 'user',
      mergeTitle: 'Mixed',
    });

    // main-v-2 has no identifiable source, so no UPDATE may name it — neither
    // provenance on it nor a back-link to it.
    const updated = calls(documentVersions).update;
    expect(updated.some(({ params }) => params.includes('main-v-2'))).toBe(false);

    // Only the entry with a source is touched: provenance plus back-link.
    expect(updated).toHaveLength(2);

    // But both documents are still in the publish checkpoint.
    expect(createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersionIds: [
          { documentId: 'doc-1', documentVersionId: 'main-v-1' },
          { documentId: 'doc-2', documentVersionId: 'main-v-2' },
        ],
      }),
    );
  });

  it('writes no provenance UPDATEs when the publish checkpoint fails', async () => {
    // If createCheckpoint fails, the helper must throw without leaving any
    // provenance fields populated — otherwise we'd have orphan provenance
    // pointing at versions that aren't actually published.
    const { statements } = database;
    vi.mocked(createCheckpoint).mockRejectedValueOnce(
      new Error('Checkpoint creation failed'),
    );

    await expect(
      publishMergedVersions({
        siteId: 'site-1',
        mainBranchId: 'main-branch',
        sourceBranchId: 'source-branch',
        mergedVersions: [
          {
            documentId: 'doc-1',
            documentVersionId: 'main-v-1',
            sourceVersionId: 'source-v-1',
          },
        ],
        mergedById: 'user-1',
        mergedByType: 'user',
        mergeTitle: 'Failing',
      }),
    ).rejects.toThrow('Checkpoint creation failed');

    // No provenance UPDATEs should have run — checkpoint failed first.
    expect(statements).toHaveLength(0);
  });

  it('returns publishedCount = 0 and skips DB work entirely when no merged versions are passed', async () => {
    const { statements } = database;

    const result = await publishMergedVersions({
      siteId: 'site-1',
      mainBranchId: 'main-branch',
      sourceBranchId: 'source-branch',
      mergedVersions: [],
      mergedById: 'user-1',
      mergedByType: 'user',
      mergeTitle: 'Empty',
    });

    expect(result.publishedCount).toBe(0);
    expect(result.checkpointId).toBeUndefined();
    expect(createCheckpoint).not.toHaveBeenCalled();
    expect(statements).toHaveLength(0);
  });
});
