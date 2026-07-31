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

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
}));

describe('publishMergedVersions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('creates the publish checkpoint on main BEFORE writing any provenance UPDATE', async () => {
    // Ordering matters: createCheckpoint runs in its own transaction. If it
    // fails we must leave NO provenance behind (so isPublished stays false
    // and the document stays in its pre-merge state). The helper achieves
    // this by calling createCheckpoint first, then doing UPDATEs.
    const { publishMergedVersions } = await import(
      '../../src/services/merge-publish'
    );
    const db = await import('../../src/db');
    const checkpointService = await import('../../src/services/checkpoint-service');

    const callOrder: string[] = [];
    vi.mocked(checkpointService.createCheckpoint).mockImplementationOnce(() => {
      callOrder.push('createCheckpoint');
      return Promise.resolve({
        checkpoint: {
          id: 'checkpoint-publish-merge-1',
          branchId: 'main-branch',
          name: 'Auto-publish: Feature merge',
          checkpointType: 'publish',
          createdAt: '2026-04-25T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
        },
        documentCount: 1,
      });
    });
    vi.mocked(db.query).mockImplementation(() => {
      callOrder.push('query');
      return Promise.resolve({ rows: [], rowCount: 1 } as never);
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
    expect(checkpointService.createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'main-branch',
        checkpointType: 'publish',
        documentVersionIds: [
          { documentId: 'doc-1', documentVersionId: 'main-v-1' },
        ],
      }),
    );

    // Ordering: createCheckpoint runs first; provenance queries follow.
    expect(callOrder[0]).toBe('createCheckpoint');
    expect(callOrder.slice(1).every((c) => c === 'query')).toBe(true);

    expect(result.checkpointId).toBe('checkpoint-publish-merge-1');
    expect(result.publishedCount).toBe(1);
  });

  it('sets source_branch_id and source_version_id on the main-side version when sourceVersionId is set', async () => {
    const { publishMergedVersions } = await import(
      '../../src/services/merge-publish'
    );
    const db = await import('../../src/db');
    const checkpointService = await import('../../src/services/checkpoint-service');

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });
    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'cp-1',
        branchId: 'main-branch',
        name: 'Auto-publish',
        checkpointType: 'publish',
        createdAt: '2026-04-25T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });

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

    // Find the call that updated the main-side version's provenance
    const provenanceCall = vi.mocked(db.query).mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('source_branch_id') &&
        sql.includes('source_version_id') &&
        sql.toUpperCase().includes('UPDATE'),
    );
    expect(provenanceCall).toBeDefined();
    expect(provenanceCall?.[1]).toEqual(
      expect.arrayContaining(['source-branch', 'source-v-1', 'main-v-1']),
    );
  });

  it('sets published_to_version_id back-link on the source-branch version when sourceVersionId is set', async () => {
    const { publishMergedVersions } = await import(
      '../../src/services/merge-publish'
    );
    const db = await import('../../src/db');
    const checkpointService = await import('../../src/services/checkpoint-service');

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });
    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'cp-1',
        branchId: 'main-branch',
        name: 'Auto-publish',
        checkpointType: 'publish',
        createdAt: '2026-04-25T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });

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

    // Find the call that updated the back-link on the source-branch version
    const backlinkCall = vi.mocked(db.query).mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('published_to_version_id') &&
        sql.toUpperCase().includes('UPDATE'),
    );
    expect(backlinkCall).toBeDefined();
    expect(backlinkCall?.[1]).toEqual(
      expect.arrayContaining(['main-v-1', 'source-v-1']),
    );
  });

  it('skips provenance updates for entries with sourceVersionId === null but still includes them in publish checkpoint', async () => {
    const { publishMergedVersions } = await import(
      '../../src/services/merge-publish'
    );
    const db = await import('../../src/db');
    const checkpointService = await import('../../src/services/checkpoint-service');

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });
    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'cp-1',
        branchId: 'main-branch',
        name: 'Auto-publish',
        checkpointType: 'publish',
        createdAt: '2026-04-25T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 2,
    });

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

    // Provenance UPDATE for main-v-2 must NOT exist (no source for it).
    const noSourceProvenance = vi
      .mocked(db.query)
      .mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('source_branch_id') &&
          Array.isArray(params) &&
          params.includes('main-v-2'),
      );
    expect(noSourceProvenance).toBe(false);

    // Back-link UPDATE for any non-existent source must NOT exist.
    const noSourceBacklink = vi
      .mocked(db.query)
      .mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('published_to_version_id') &&
          Array.isArray(params) &&
          params.includes('main-v-2'),
      );
    expect(noSourceBacklink).toBe(false);

    // But both documents are still in the publish checkpoint.
    expect(checkpointService.createCheckpoint).toHaveBeenCalledWith(
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
    const { publishMergedVersions } = await import(
      '../../src/services/merge-publish'
    );
    const db = await import('../../src/db');
    const checkpointService = await import('../../src/services/checkpoint-service');

    vi.mocked(checkpointService.createCheckpoint).mockRejectedValueOnce(
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
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns publishedCount = 0 and skips DB work entirely when no merged versions are passed', async () => {
    const { publishMergedVersions } = await import(
      '../../src/services/merge-publish'
    );
    const db = await import('../../src/db');
    const checkpointService = await import('../../src/services/checkpoint-service');

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
    expect(checkpointService.createCheckpoint).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});
