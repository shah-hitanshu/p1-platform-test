/**
 * Merge Execution: Auto-Publish-on-Merge Integration Tests (TDD - Red State)
 *
 * Verifies that when an executed merge targets the main branch, the
 * merge-created versions are also marked as published via the
 * publishMergedVersions() helper. Verifies the safety constraint: only
 * documents the source branch actually changed are touched — main-side
 * unpublished edits to other documents are never affected.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeBranch } from '../helpers/branch';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/conflict-detection-service', () => ({
  detectConflicts: vi.fn(),
}));

vi.mock('../../src/services/conflict-resolution-service', () => ({
  resolveConflict: vi.fn(),
  resolveAllConflicts: vi.fn(),
  resolveDeletedConflict: vi.fn(),
}));

vi.mock('../../src/services/merge-request-service', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/services/merge-request-service')
  >();
  return {
    ...actual,
    getMergeRequest: vi.fn(),
    updateMergeRequestStatus: vi.fn(),
    updateMergeRequestConflicts: vi.fn(),
  };
});

vi.mock('../../src/services/document-version-service', () => ({
  createDocumentVersion: vi.fn(),
  getDocumentVersion: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
}));

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
}));

vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
  updateBranchStatus: vi.fn(),
}));

vi.mock('../../src/services/merge-publish', () => ({
  publishMergedVersions: vi.fn(),
}));

const baseMergeRequest = {
  id: 'mr-1',
  siteId: 'site-1',
  sourceBranchId: 'source-branch',
  targetBranchId: 'main-branch',
  title: 'Feature merge',
  status: 'approved' as const,
  hasConflicts: false,
  createdById: 'user-1',
  createdByType: 'user' as const,
  createdAt: '2026-04-25T10:00:00.000Z',
  updatedAt: '2026-04-25T10:00:00.000Z',
};

const baseMainBranch = makeBranch({
  id: 'main-branch',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  isDefault: true,
  status: 'active' as const,
  createdById: 'user-1',
  createdByType: 'user' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('executeMerge auto-publish (target = main)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls publishMergedVersions with the merge-created versions when target is main', async () => {
    const { executeMerge } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const docVersionService = await import(
      '../../src/services/document-version-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');
    const mergePublish = await import('../../src/services/merge-publish');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce(
      baseMergeRequest,
    );
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(baseMainBranch);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: false,
      conflicts: { documentConflicts: [], structureConflicts: [] },
      mergeBase: {
        checkpointId: 'checkpoint-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-1',
          latestVersionNumber: 2,
          baseVersionId: 'base-v-1',
          baseVersionNumber: 1,
        },
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          latestVersionId: 'source-v-2',
          latestVersionNumber: 3,
          baseVersionId: 'base-v-2',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [],
    });

    vi.mocked(docVersionService.getDocumentVersion)
      .mockResolvedValueOnce({
        id: 'source-v-1',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 2,
        snapshot: { title: 'Home v2' },
        createdAt: '2026-04-21T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      })
      .mockResolvedValueOnce({
        id: 'source-v-2',
        documentId: 'doc-2',
        branchId: 'source-branch',
        versionNumber: 3,
        snapshot: { title: 'About v3' },
        createdAt: '2026-04-21T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

    vi.mocked(docVersionService.createDocumentVersion)
      .mockResolvedValueOnce({
        id: 'main-v-1',
        documentId: 'doc-1',
        branchId: 'main-branch',
        versionNumber: 5,
        snapshot: { title: 'Home v2' },
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      })
      .mockResolvedValueOnce({
        id: 'main-v-2',
        documentId: 'doc-2',
        branchId: 'main-branch',
        versionNumber: 4,
        snapshot: { title: 'About v3' },
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      });

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'checkpoint-post-merge',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 2,
    });

    vi.mocked(mergePublish.publishMergedVersions).mockResolvedValueOnce({
      checkpointId: 'checkpoint-publish-merge',
      publishedCount: 2,
    });

    vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
      ...baseMergeRequest,
      status: 'merged',
      mergedAt: '2026-04-25T11:00:00.000Z',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    const result = await executeMerge({
      mergeRequestId: 'mr-1',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    expect(result.success).toBe(true);
    expect(mergePublish.publishMergedVersions).toHaveBeenCalledTimes(1);
    expect(mergePublish.publishMergedVersions).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-1',
        mainBranchId: 'main-branch',
        sourceBranchId: 'source-branch',
        mergedById: 'user-1',
        mergedByType: 'user',
        mergeTitle: 'Feature merge',
        mergedVersions: [
          {
            documentId: 'doc-1',
            documentVersionId: 'main-v-1',
            sourceVersionId: 'source-v-1',
          },
          {
            documentId: 'doc-2',
            documentVersionId: 'main-v-2',
            sourceVersionId: 'source-v-2',
          },
        ],
      }),
    );
  });

  it('does NOT call publishMergedVersions when target branch is not main', async () => {
    const { executeMerge } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const docVersionService = await import(
      '../../src/services/document-version-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');
    const mergePublish = await import('../../src/services/merge-publish');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      targetBranchId: 'feature-branch-c',
    });
    // Main branch lookup still resolves, but its id differs from targetBranchId.
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(baseMainBranch);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: false,
      conflicts: { documentConflicts: [], structureConflicts: [] },
      mergeBase: {
        checkpointId: 'checkpoint-base',
        branchId: 'feature-branch-c',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-1',
          latestVersionNumber: 2,
          baseVersionId: 'base-v-1',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [],
    });

    vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
      id: 'source-v-1',
      documentId: 'doc-1',
      branchId: 'source-branch',
      versionNumber: 2,
      snapshot: { title: 'Home v2' },
      createdAt: '2026-04-21T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit',
    });

    vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
      id: 'feature-c-v-1',
      documentId: 'doc-1',
      branchId: 'feature-branch-c',
      versionNumber: 5,
      snapshot: { title: 'Home v2' },
      createdAt: '2026-04-25T11:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'merge',
    });

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'checkpoint-post-merge',
        branchId: 'feature-branch-c',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });

    vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
      ...baseMergeRequest,
      targetBranchId: 'feature-branch-c',
      status: 'merged',
      mergedAt: '2026-04-25T11:00:00.000Z',
    });

    const result = await executeMerge({
      mergeRequestId: 'mr-1',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    expect(result.success).toBe(true);
    expect(mergePublish.publishMergedVersions).not.toHaveBeenCalled();
  });

  it('passes only merge-touched documents to publishMergedVersions (untouched main docs are not in the list)', async () => {
    // Safety test: main has many documents (with unpublished edits), but the
    // source branch only changed one. publishMergedVersions must receive ONLY
    // that one document — never the rest of main.
    const { executeMerge } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const docVersionService = await import(
      '../../src/services/document-version-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');
    const mergePublish = await import('../../src/services/merge-publish');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce(
      baseMergeRequest,
    );
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(baseMainBranch);

    // Source touched ONLY doc-touched. Main has many other docs (doc-untouched-1..N)
    // but they don't appear in sourceChanges.
    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: false,
      conflicts: { documentConflicts: [], structureConflicts: [] },
      mergeBase: {
        checkpointId: 'checkpoint-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-touched',
          documentPath: 'pages/touched',
          latestVersionId: 'source-v-touched',
          latestVersionNumber: 2,
          baseVersionId: 'base-v-touched',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [],
    });

    vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
      id: 'source-v-touched',
      documentId: 'doc-touched',
      branchId: 'source-branch',
      versionNumber: 2,
      snapshot: { title: 'Touched' },
      createdAt: '2026-04-21T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit',
    });

    vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
      id: 'main-v-touched',
      documentId: 'doc-touched',
      branchId: 'main-branch',
      versionNumber: 5,
      snapshot: { title: 'Touched' },
      createdAt: '2026-04-25T11:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'merge',
    });

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'checkpoint-post-merge',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });

    vi.mocked(mergePublish.publishMergedVersions).mockResolvedValueOnce({
      checkpointId: 'checkpoint-publish-merge',
      publishedCount: 1,
    });

    vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
      ...baseMergeRequest,
      status: 'merged',
      mergedAt: '2026-04-25T11:00:00.000Z',
    });

    await executeMerge({
      mergeRequestId: 'mr-1',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    const call = vi.mocked(mergePublish.publishMergedVersions).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call?.mergedVersions).toEqual([
      {
        documentId: 'doc-touched',
        documentVersionId: 'main-v-touched',
        sourceVersionId: 'source-v-touched',
      },
    ]);
    // Sanity: no untouched docs leaked in.
    const docIds = call?.mergedVersions.map((v) => v.documentId);
    expect(docIds).not.toContain('doc-untouched-1');
  });

  it('does not fail the merge if publishMergedVersions throws (publish failure is surfaced but merge stays committed)', async () => {
    const { executeMerge } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const docVersionService = await import(
      '../../src/services/document-version-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');
    const mergePublish = await import('../../src/services/merge-publish');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce(
      baseMergeRequest,
    );
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(baseMainBranch);
    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: false,
      conflicts: { documentConflicts: [], structureConflicts: [] },
      mergeBase: {
        checkpointId: 'checkpoint-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-1',
          latestVersionNumber: 2,
          baseVersionId: 'base-v-1',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [],
    });
    vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
      id: 'source-v-1',
      documentId: 'doc-1',
      branchId: 'source-branch',
      versionNumber: 2,
      snapshot: { title: 'Home' },
      createdAt: '2026-04-21T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit',
    });
    vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
      id: 'main-v-1',
      documentId: 'doc-1',
      branchId: 'main-branch',
      versionNumber: 5,
      snapshot: { title: 'Home' },
      createdAt: '2026-04-25T11:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'merge',
    });
    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'checkpoint-post-merge',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });
    vi.mocked(mergePublish.publishMergedVersions).mockRejectedValueOnce(
      new Error('Publish failed'),
    );
    vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
      ...baseMergeRequest,
      status: 'merged',
      mergedAt: '2026-04-25T11:00:00.000Z',
    });

    const result = await executeMerge({
      mergeRequestId: 'mr-1',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    // Merge itself succeeded.
    expect(result.success).toBe(true);
    expect(result.checkpointId).toBe('checkpoint-post-merge');
    // But the publish error is surfaced on the result.
    expect(result.publishError).toBeDefined();
    expect(result.publishError).toContain('Publish failed');
    // Merge request was still transitioned to 'merged'.
    expect(mergeRequestService.updateMergeRequestStatus).toHaveBeenCalledWith(
      'mr-1',
      'merged',
      expect.any(Object),
    );
  });
});

describe('executeMergeWithResolution auto-publish (target = main)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes sourceVersionId for take-source resolutions', async () => {
    const { executeMergeWithResolution } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const conflictResolution = await import(
      '../../src/services/conflict-resolution-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');
    const mergePublish = await import('../../src/services/merge-publish');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      hasConflicts: true,
    });
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(baseMainBranch);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      },
      mergeBase: {
        checkpointId: 'checkpoint-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-conflict',
          latestVersionNumber: 3,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'main-v-conflict',
          latestVersionNumber: 2,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
    });

    vi.mocked(conflictResolution.resolveAllConflicts).mockResolvedValueOnce({
      resolvedCount: 1,
      failedCount: 0,
      resolutions: [
        {
          resolved: true,
          documentId: 'doc-1',
          strategy: 'take-source',
          resultVersionId: 'main-v-resolved',
          resolvedById: 'user-1',
          resolvedByType: 'user',
        },
      ],
    });

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'checkpoint-post-merge',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });

    vi.mocked(mergePublish.publishMergedVersions).mockResolvedValueOnce({
      checkpointId: 'checkpoint-publish-merge',
      publishedCount: 1,
    });

    vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
      ...baseMergeRequest,
      status: 'merged',
      mergedAt: '2026-04-25T11:00:00.000Z',
    });

    await executeMergeWithResolution({
      mergeRequestId: 'mr-1',
      resolutionStrategy: 'take-source',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    expect(mergePublish.publishMergedVersions).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(mergePublish.publishMergedVersions).mock.calls[0]?.[0];
    expect(arg?.mergedVersions).toEqual([
      {
        documentId: 'doc-1',
        documentVersionId: 'main-v-resolved',
        sourceVersionId: 'source-v-conflict',
      },
    ]);
  });

  it('passes sourceVersionId = null for take-target resolutions', async () => {
    const { executeMergeWithResolution } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const conflictResolution = await import(
      '../../src/services/conflict-resolution-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');
    const mergePublish = await import('../../src/services/merge-publish');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      hasConflicts: true,
    });
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(baseMainBranch);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      },
      mergeBase: {
        checkpointId: 'checkpoint-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-conflict',
          latestVersionNumber: 3,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'main-v-conflict',
          latestVersionNumber: 2,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
    });

    vi.mocked(conflictResolution.resolveAllConflicts).mockResolvedValueOnce({
      resolvedCount: 1,
      failedCount: 0,
      resolutions: [
        {
          resolved: true,
          documentId: 'doc-1',
          strategy: 'take-target',
          resultVersionId: 'main-v-resolved-target',
          resolvedById: 'user-1',
          resolvedByType: 'user',
        },
      ],
    });

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'checkpoint-post-merge',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });

    vi.mocked(mergePublish.publishMergedVersions).mockResolvedValueOnce({
      checkpointId: 'checkpoint-publish-merge',
      publishedCount: 1,
    });

    vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
      ...baseMergeRequest,
      status: 'merged',
      mergedAt: '2026-04-25T11:00:00.000Z',
    });

    await executeMergeWithResolution({
      mergeRequestId: 'mr-1',
      resolutionStrategy: 'take-target',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    const arg = vi.mocked(mergePublish.publishMergedVersions).mock.calls[0]?.[0];
    expect(arg?.mergedVersions).toEqual([
      {
        documentId: 'doc-1',
        documentVersionId: 'main-v-resolved-target',
        sourceVersionId: null,
      },
    ]);
  });

  it('passes sourceVersionId = null for manual resolutions', async () => {
    const { executeMergeWithResolution } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const docVersionService = await import(
      '../../src/services/document-version-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');
    const mergePublish = await import('../../src/services/merge-publish');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      hasConflicts: true,
    });
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(baseMainBranch);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      },
      mergeBase: {
        checkpointId: 'checkpoint-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-conflict',
          latestVersionNumber: 3,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'main-v-conflict',
          latestVersionNumber: 2,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
    });

    vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
      id: 'main-v-manual',
      documentId: 'doc-1',
      branchId: 'main-branch',
      versionNumber: 7,
      snapshot: { title: 'Manually merged' },
      createdAt: '2026-04-25T11:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'merge',
    });

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'checkpoint-post-merge',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });

    vi.mocked(mergePublish.publishMergedVersions).mockResolvedValueOnce({
      checkpointId: 'checkpoint-publish-merge',
      publishedCount: 1,
    });

    vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
      ...baseMergeRequest,
      status: 'merged',
      mergedAt: '2026-04-25T11:00:00.000Z',
    });

    await executeMergeWithResolution({
      mergeRequestId: 'mr-1',
      resolutionStrategy: 'take-source',
      resolutions: [
        {
          documentId: 'doc-1',
          strategy: 'manual',
          resolvedSnapshot: { title: 'Manually merged' },
        },
      ],
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    const arg = vi.mocked(mergePublish.publishMergedVersions).mock.calls[0]?.[0];
    expect(arg?.mergedVersions).toEqual([
      {
        documentId: 'doc-1',
        documentVersionId: 'main-v-manual',
        sourceVersionId: null,
      },
    ]);
  });

  it('does not fail the merge if publishMergedVersions throws (conflict-resolution path)', async () => {
    // Mirrors the executeMerge failure-isolation test for the
    // executeMergeWithResolution flow: a publish failure must surface as
    // result.publishError without rolling back the merge or its conflict
    // resolution.
    const { executeMergeWithResolution } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const conflictResolution = await import(
      '../../src/services/conflict-resolution-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');
    const mergePublish = await import('../../src/services/merge-publish');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      hasConflicts: true,
    });
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(baseMainBranch);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/home',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      },
      mergeBase: {
        checkpointId: 'checkpoint-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-conflict',
          latestVersionNumber: 3,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'main-v-conflict',
          latestVersionNumber: 2,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
    });

    vi.mocked(conflictResolution.resolveAllConflicts).mockResolvedValueOnce({
      resolvedCount: 1,
      failedCount: 0,
      resolutions: [
        {
          resolved: true,
          documentId: 'doc-1',
          strategy: 'take-source',
          resultVersionId: 'main-v-resolved',
          resolvedById: 'user-1',
          resolvedByType: 'user',
        },
      ],
    });

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'checkpoint-post-merge',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 1,
    });

    vi.mocked(mergePublish.publishMergedVersions).mockRejectedValueOnce(
      new Error('Publish failed in resolution path'),
    );

    vi.mocked(mergeRequestService.updateMergeRequestStatus).mockResolvedValueOnce({
      ...baseMergeRequest,
      status: 'merged',
      mergedAt: '2026-04-25T11:00:00.000Z',
    });

    const result = await executeMergeWithResolution({
      mergeRequestId: 'mr-1',
      resolutionStrategy: 'take-source',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    expect(result.success).toBe(true);
    expect(result.checkpointId).toBe('checkpoint-post-merge');
    expect(result.conflictsResolved).toBe(1);
    expect(result.publishError).toBeDefined();
    expect(result.publishError).toContain('Publish failed in resolution path');
  });
});
