/**
 * Merge Execution: No-op Skip in copySourceChangesToTarget (TDD - Red State)
 *
 * Verifies that when copySourceChangesToTarget calls createDocumentVersion
 * but the returned version's ID matches the pre-existing latest version on
 * the target branch (i.e., createDocumentVersion's unique-violation fallback
 * returned an existing row, no real merge work happened for that document),
 * the entry is NOT pushed into mergedVersions.
 *
 * Without this filter, the post_merge checkpoint and the auto-publish
 * checkpoint end up referencing pre-existing target-branch versions that
 * weren't actually changed by the current merge — which is the inflation
 * we observed in production (32-doc checkpoints when only 1 doc actually
 * changed).
 *
 * Tests written BEFORE implementation following TDD methodology.
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

describe('copySourceChangesToTarget — no-op skip', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('skips entries where createDocumentVersion returned the pre-existing latest version (no real merge happened)', async () => {
    // Simulates the production scenario: source branch has 2 docs in
    // sourceChanges. For doc-A, createDocumentVersion creates a NEW v2 on
    // main. For doc-B, createDocumentVersion's unique-violation fallback
    // returns the pre-existing main-side v1 (no new work).
    // Expectation: only doc-A is in copiedVersions and downstream checkpoints.
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
          documentId: 'doc-A',
          documentPath: 'pages/a',
          latestVersionId: 'source-v-a',
          latestVersionNumber: 2,
          baseVersionId: 'base-v-a',
          baseVersionNumber: 1,
        },
        {
          documentId: 'doc-B',
          documentPath: 'pages/b',
          latestVersionId: 'source-v-b',
          latestVersionNumber: 2,
          baseVersionId: 'base-v-b',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [],
    });

    // Source versions
    vi.mocked(docVersionService.getDocumentVersion)
      .mockResolvedValueOnce({
        id: 'source-v-a',
        documentId: 'doc-A',
        branchId: 'source-branch',
        versionNumber: 2,
        snapshot: { title: 'A v2' },
        createdAt: '2026-04-21T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      })
      .mockResolvedValueOnce({
        id: 'source-v-b',
        documentId: 'doc-B',
        branchId: 'source-branch',
        versionNumber: 2,
        snapshot: { title: 'B v2' },
        createdAt: '2026-04-21T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

    // Pre-existing latest on main:
    //   doc-A: v1 (id=main-v-a-old). After createDocumentVersion runs, doc-A
    //          will have a NEW v2 (id=main-v-a-new) — real merge work.
    //   doc-B: v1 (id=main-v-b-existing). createDocumentVersion will return
    //          this SAME id (unique-violation fallback) — no real work.
    vi.mocked(docVersionService.getLatestDocumentVersion)
      .mockResolvedValueOnce({
        id: 'main-v-a-old',
        documentId: 'doc-A',
        branchId: 'main-branch',
        versionNumber: 1,
        snapshot: { title: 'A v1' },
        createdAt: '2026-04-15T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      })
      .mockResolvedValueOnce({
        id: 'main-v-b-existing',
        documentId: 'doc-B',
        branchId: 'main-branch',
        versionNumber: 1,
        snapshot: { title: 'B v1' },
        createdAt: '2026-04-15T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

    vi.mocked(docVersionService.createDocumentVersion)
      // doc-A: real new version
      .mockResolvedValueOnce({
        id: 'main-v-a-new',
        documentId: 'doc-A',
        branchId: 'main-branch',
        versionNumber: 2,
        snapshot: { title: 'A v2' },
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'merge',
      })
      // doc-B: unique-violation fallback returns the pre-existing version
      .mockResolvedValueOnce({
        id: 'main-v-b-existing',
        documentId: 'doc-B',
        branchId: 'main-branch',
        versionNumber: 1,
        snapshot: { title: 'B v1' },
        createdAt: '2026-04-15T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
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

    const result = await executeMerge({
      mergeRequestId: 'mr-1',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    expect(result.success).toBe(true);

    // Only doc-A counts as actually merged.
    expect(result.documentsUpdated).toBe(1);

    // post_merge checkpoint receives only doc-A (not doc-B).
    const ckptCall = vi.mocked(checkpointService.createCheckpoint).mock.calls[0]?.[0];
    expect(ckptCall?.documentVersionIds).toEqual([
      { documentId: 'doc-A', documentVersionId: 'main-v-a-new' },
    ]);

    // Auto-publish receives only doc-A (no doc-B contamination).
    const pubCall = vi.mocked(mergePublish.publishMergedVersions).mock.calls[0]?.[0];
    expect(pubCall?.mergedVersions).toEqual([
      {
        documentId: 'doc-A',
        documentVersionId: 'main-v-a-new',
        sourceVersionId: 'source-v-a',
      },
    ]);
  });

  it('still includes a doc when no pre-existing version is on the target (first-time creation)', async () => {
    // First-time merge: source has doc-NEW, main has nothing for that doc.
    // getLatestDocumentVersion returns null. createDocumentVersion creates
    // v1 (no fallback could fire). Doc must be included.
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
          documentId: 'doc-NEW',
          documentPath: 'pages/new',
          latestVersionId: 'source-v-new',
          latestVersionNumber: 1,
          baseVersionId: null,
          baseVersionNumber: null,
        },
      ],
      targetChanges: [],
    });

    vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
      id: 'source-v-new',
      documentId: 'doc-NEW',
      branchId: 'source-branch',
      versionNumber: 1,
      snapshot: { title: 'New' },
      createdAt: '2026-04-21T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit',
    });

    // No pre-existing version on main for this doc.
    vi.mocked(docVersionService.getLatestDocumentVersion).mockResolvedValueOnce(null);

    vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
      id: 'main-v-new',
      documentId: 'doc-NEW',
      branchId: 'main-branch',
      versionNumber: 1,
      snapshot: { title: 'New' },
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

    const result = await executeMerge({
      mergeRequestId: 'mr-1',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    expect(result.success).toBe(true);
    expect(result.documentsUpdated).toBe(1);

    const ckptCall = vi.mocked(checkpointService.createCheckpoint).mock.calls[0]?.[0];
    expect(ckptCall?.documentVersionIds).toEqual([
      { documentId: 'doc-NEW', documentVersionId: 'main-v-new' },
    ]);
  });

  it('skips take-source resolution when resolver returned the pre-existing target version', async () => {
    // executeMergeWithResolution path: take-source resolution where the
    // source snapshot is identical to main's existing version (resolver
    // returns the existing target version id). Must be excluded from the
    // post_merge checkpoint.
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
    const docVersionService = await import(
      '../../src/services/document-version-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      hasConflicts: true,
    });
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(null);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-conflict',
            documentPath: 'pages/conflict',
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
          documentId: 'doc-conflict',
          documentPath: 'pages/conflict',
          latestVersionId: 'source-v',
          latestVersionNumber: 3,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-conflict',
          documentPath: 'pages/conflict',
          latestVersionId: 'target-v',
          latestVersionNumber: 2,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
    });

    // Pre-existing latest on main = target-v.
    const existing = {
      id: 'target-v',
      documentId: 'doc-conflict',
      branchId: 'main-branch',
      versionNumber: 2,
      snapshot: { title: 'Existing' },
      createdAt: '2026-04-15T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit' as const,
    };
    vi.mocked(docVersionService.getLatestDocumentVersion).mockResolvedValueOnce(existing);

    // Resolver returns the SAME id as the pre-existing latest target.
    vi.mocked(conflictResolution.resolveAllConflicts).mockResolvedValueOnce({
      resolvedCount: 1,
      failedCount: 0,
      resolutions: [
        {
          resolved: true,
          documentId: 'doc-conflict',
          strategy: 'take-source',
          resultVersionId: 'target-v', // <-- same as preExistingLatest
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
      documentCount: 0,
    });

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
    // The conflict was "resolved" (resolveAllConflicts ran), but the no-op
    // skip suppressed it from the checkpoint.
    expect(result.conflictsResolved).toBe(1);
    const ckptCall = vi.mocked(checkpointService.createCheckpoint).mock.calls[0]?.[0];
    expect(ckptCall?.documentVersionIds).toEqual([]);
  });

  it('skips take-target resolution from the post_merge checkpoint (always a no-op for the target)', async () => {
    // take-target by definition returns the existing target version id.
    // The no-op skip suppresses it.
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
    const docVersionService = await import(
      '../../src/services/document-version-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      hasConflicts: true,
    });
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(null);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-c',
            documentPath: 'pages/c',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      },
      mergeBase: {
        checkpointId: 'cp-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-c',
          documentPath: 'pages/c',
          latestVersionId: 'source-v',
          latestVersionNumber: 3,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-c',
          documentPath: 'pages/c',
          latestVersionId: 'target-v',
          latestVersionNumber: 2,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
    });

    const existing = {
      id: 'target-v',
      documentId: 'doc-c',
      branchId: 'main-branch',
      versionNumber: 2,
      snapshot: { title: 'Existing target' },
      createdAt: '2026-04-15T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit' as const,
    };
    vi.mocked(docVersionService.getLatestDocumentVersion).mockResolvedValueOnce(existing);

    vi.mocked(conflictResolution.resolveAllConflicts).mockResolvedValueOnce({
      resolvedCount: 1,
      failedCount: 0,
      resolutions: [
        {
          resolved: true,
          documentId: 'doc-c',
          strategy: 'take-target',
          resultVersionId: 'target-v', // take-target returns the existing target id
          resolvedById: 'user-1',
          resolvedByType: 'user',
        },
      ],
    });

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'cp-post',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 0,
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

    const ckptCall = vi.mocked(checkpointService.createCheckpoint).mock.calls[0]?.[0];
    expect(ckptCall?.documentVersionIds).toEqual([]);
  });

  it('skips manual resolution when the manual snapshot resolves to the existing target version', async () => {
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

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      hasConflicts: true,
    });
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(null);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-m',
            documentPath: 'pages/m',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      },
      mergeBase: {
        checkpointId: 'cp-base',
        branchId: 'main-branch',
        createdAt: '2026-04-20T10:00:00.000Z',
      },
      sourceChanges: [
        {
          documentId: 'doc-m',
          documentPath: 'pages/m',
          latestVersionId: 'source-v',
          latestVersionNumber: 3,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-m',
          documentPath: 'pages/m',
          latestVersionId: 'target-v',
          latestVersionNumber: 2,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
    });

    const existing = {
      id: 'target-v',
      documentId: 'doc-m',
      branchId: 'main-branch',
      versionNumber: 2,
      snapshot: { title: 'Existing' },
      createdAt: '2026-04-15T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit' as const,
    };
    vi.mocked(docVersionService.getLatestDocumentVersion).mockResolvedValueOnce(existing);

    // createDocumentVersion returns the SAME id as the pre-existing latest
    // (unique-violation fallback).
    vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce(existing);

    vi.mocked(checkpointService.createCheckpoint).mockResolvedValueOnce({
      checkpoint: {
        id: 'cp-post',
        branchId: 'main-branch',
        name: 'Merge: Feature merge',
        checkpointType: 'post_merge',
        createdAt: '2026-04-25T11:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      },
      documentCount: 0,
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
          documentId: 'doc-m',
          strategy: 'manual',
          resolvedSnapshot: { title: 'Existing' },
        },
      ],
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    const ckptCall = vi.mocked(checkpointService.createCheckpoint).mock.calls[0]?.[0];
    expect(ckptCall?.documentVersionIds).toEqual([]);
  });

  it('does not call publishMergedVersions when all source changes resolve to no-op (empty merge)', async () => {
    // Pathological case: every source change resolves to an existing
    // main version. Result: zero merged docs, zero post_merge entries,
    // zero auto-publish call (per existing zero-versions short-circuit
    // in autoPublishIfTargetIsMain).
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
          documentId: 'doc-noop',
          documentPath: 'pages/noop',
          latestVersionId: 'source-v-noop',
          latestVersionNumber: 1,
          baseVersionId: null,
          baseVersionNumber: null,
        },
      ],
      targetChanges: [],
    });

    vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
      id: 'source-v-noop',
      documentId: 'doc-noop',
      branchId: 'source-branch',
      versionNumber: 1,
      snapshot: { title: 'Noop' },
      createdAt: '2026-04-21T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit',
    });

    // Pre-existing on main; createDocumentVersion returns the SAME id.
    const existing = {
      id: 'main-v-noop-existing',
      documentId: 'doc-noop',
      branchId: 'main-branch',
      versionNumber: 1,
      snapshot: { title: 'Noop' },
      createdAt: '2026-04-15T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit' as const,
    };
    vi.mocked(docVersionService.getLatestDocumentVersion).mockResolvedValueOnce(existing);
    vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce(existing);

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
      documentCount: 0,
    });

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

    expect(result.success).toBe(true);
    expect(result.documentsUpdated).toBe(0);

    // post_merge checkpoint should be empty.
    const ckptCall = vi.mocked(checkpointService.createCheckpoint).mock.calls[0]?.[0];
    expect(ckptCall?.documentVersionIds).toEqual([]);

    // Auto-publish must NOT be called when there are no real merged docs
    // (the existing zero-versions short-circuit handles this).
    expect(mergePublish.publishMergedVersions).not.toHaveBeenCalled();
  });
});
