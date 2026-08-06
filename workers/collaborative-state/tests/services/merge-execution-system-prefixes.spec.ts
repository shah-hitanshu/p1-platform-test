/**
 * Merge Execution: System-Managed Path Prefix Exclusion (TDD - Red State)
 *
 * Verifies that documents under system-managed path prefixes (currently just
 * `_registry/`) are excluded from merge execution and preview, regardless of
 * caller-provided excludePathPrefixes. The `_registry/` content is owned by
 * Pantheon core code, not the user's site, so it must never appear in a
 * post_merge or auto-publish checkpoint.
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

vi.mock('../../src/services/document-diff-service', () => ({
  computeDocumentDiffs: vi.fn(),
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

describe('executeMerge — system-managed path exclusion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('excludes documents under _registry/ from merge writes and post_merge checkpoint', async () => {
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

    // Source has 1 real change + 2 _registry changes (which must be filtered out).
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
          documentId: 'doc-real',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-real',
          latestVersionNumber: 2,
          baseVersionId: 'base-v-real',
          baseVersionNumber: 1,
        },
        {
          documentId: 'doc-registry-1',
          documentPath: '_registry/components/Hero',
          latestVersionId: 'source-v-reg-1',
          latestVersionNumber: 3,
          baseVersionId: null,
          baseVersionNumber: null,
        },
        {
          documentId: 'doc-registry-2',
          documentPath: '_registry/components/Footer',
          latestVersionId: 'source-v-reg-2',
          latestVersionNumber: 2,
          baseVersionId: null,
          baseVersionNumber: null,
        },
      ],
      targetChanges: [],
    });

    vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
      id: 'source-v-real',
      documentId: 'doc-real',
      branchId: 'source-branch',
      versionNumber: 2,
      snapshot: { title: 'Home v2' },
      createdAt: '2026-04-21T10:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
      source: 'edit',
    });

    vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
      id: 'main-v-real',
      documentId: 'doc-real',
      branchId: 'main-branch',
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

    // Only doc-real should be merged — the two _registry docs must be skipped.
    expect(docVersionService.createDocumentVersion).toHaveBeenCalledTimes(1);
    expect(docVersionService.createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-real' }),
    );

    // post_merge checkpoint must contain only doc-real.
    const ckptCall = vi.mocked(checkpointService.createCheckpoint).mock.calls[0]?.[0];
    expect(ckptCall?.documentVersionIds).toEqual([
      { documentId: 'doc-real', documentVersionId: 'main-v-real' },
    ]);

    // Auto-publish must contain only doc-real (no _registry contamination).
    const pubCall = vi.mocked(mergePublish.publishMergedVersions).mock.calls[0]?.[0];
    expect(pubCall?.mergedVersions).toEqual([
      {
        documentId: 'doc-real',
        documentVersionId: 'main-v-real',
        sourceVersionId: 'source-v-real',
      },
    ]);
  });

  it('excludes _registry/ conflicts from conflict detection in executeMerge', async () => {
    // If conflict detection reports a _registry conflict, executeMerge must
    // ignore it (the underlying registry is code-managed, not site content).
    // The merge proceeds without raising MergeConflictsError.
    const { executeMerge } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );
    const mergeRequestService = await import(
      '../../src/services/merge-request-service'
    );
    const checkpointService = await import('../../src/services/checkpoint-service');
    const branchService = await import('../../src/services/branch-service');

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce(
      baseMergeRequest,
    );
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(null);

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-registry-1',
            documentPath: '_registry/components/Hero',
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
          documentId: 'doc-registry-1',
          documentPath: '_registry/components/Hero',
          latestVersionId: 'source-v-reg-1',
          latestVersionNumber: 3,
          baseVersionId: null,
          baseVersionNumber: null,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-registry-1',
          documentPath: '_registry/components/Hero',
          latestVersionId: 'main-v-reg-1',
          latestVersionNumber: 2,
          baseVersionId: null,
          baseVersionNumber: null,
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

    // Must NOT throw MergeConflictsError — the only conflict is _registry,
    // which is filtered out before the conflict check.
    const result = await executeMerge({
      mergeRequestId: 'mr-1',
      mergedById: 'user-1',
      mergedByType: 'user',
    });

    expect(result.success).toBe(true);
    expect(result.documentsUpdated).toBe(0);

    // After filtering, the merge has no conflicts — the conflicted-status
    // branch must NOT be entered. (Regression guard for hasConflicts
    // recomputation in applySystemManagedExclusions.)
    expect(mergeRequestService.updateMergeRequestConflicts).not.toHaveBeenCalled();
    expect(mergeRequestService.updateMergeRequestStatus).not.toHaveBeenCalledWith(
      'mr-1',
      'conflicted',
    );
  });
});

describe('executeMergeWithResolution — system-managed path exclusion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('excludes _registry/ from conflict resolution and the post_merge checkpoint', async () => {
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

    vi.mocked(mergeRequestService.getMergeRequest).mockResolvedValueOnce({
      ...baseMergeRequest,
      hasConflicts: true,
    });
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(null);

    // Two conflicts: one _registry (must be filtered), one real (must be resolved).
    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-registry-1',
            documentPath: '_registry/components/Hero',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
          {
            documentId: 'doc-real',
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
          documentId: 'doc-registry-1',
          documentPath: '_registry/components/Hero',
          latestVersionId: 'source-v-reg',
          latestVersionNumber: 3,
          baseVersionId: null,
          baseVersionNumber: null,
        },
        {
          documentId: 'doc-real',
          documentPath: 'pages/home',
          latestVersionId: 'source-v-real',
          latestVersionNumber: 3,
          baseVersionId: 'base-v',
          baseVersionNumber: 1,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-real',
          documentPath: 'pages/home',
          latestVersionId: 'main-v-real',
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
          documentId: 'doc-real',
          strategy: 'take-source',
          resultVersionId: 'main-v-real-resolved',
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
    expect(result.conflictsResolved).toBe(1); // only doc-real, not registry

    // resolveAllConflicts must NOT have been called for the _registry conflict.
    const resolveCalls = vi.mocked(conflictResolution.resolveAllConflicts).mock.calls;
    for (const call of resolveCalls) {
      const conflicts = call[0].conflicts;
      for (const c of conflicts) {
        expect(c.documentId).not.toBe('doc-registry-1');
      }
    }

    // post_merge checkpoint must contain only doc-real.
    const ckptCall = vi.mocked(checkpointService.createCheckpoint).mock.calls[0]?.[0];
    expect(ckptCall?.documentVersionIds).toEqual([
      { documentId: 'doc-real', documentVersionId: 'main-v-real-resolved' },
    ]);
  });
});

describe('previewMerge — system-managed path exclusion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('always excludes _registry/ from preview, even when caller provides no excludePathPrefixes', async () => {
    const { previewMerge } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );

    vi.mocked(conflictDetection.detectConflicts).mockResolvedValueOnce({
      hasConflicts: true,
      conflicts: {
        documentConflicts: [
          {
            documentId: 'doc-real',
            documentPath: 'pages/home',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
          {
            documentId: 'doc-registry',
            documentPath: '_registry/components/Hero',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 3,
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
          documentId: 'doc-real',
          documentPath: 'pages/home',
          latestVersionId: 'v-real',
          latestVersionNumber: 3,
          baseVersionId: 'v-base',
          baseVersionNumber: 1,
        },
        {
          documentId: 'doc-registry',
          documentPath: '_registry/components/Hero',
          latestVersionId: 'v-reg',
          latestVersionNumber: 3,
          baseVersionId: null,
          baseVersionNumber: null,
        },
      ],
      targetChanges: [
        {
          documentId: 'doc-real',
          documentPath: 'pages/home',
          latestVersionId: 'v-real-target',
          latestVersionNumber: 2,
          baseVersionId: 'v-base',
          baseVersionNumber: 1,
        },
        {
          documentId: 'doc-registry',
          documentPath: '_registry/components/Hero',
          latestVersionId: 'v-reg-target',
          latestVersionNumber: 3,
          baseVersionId: null,
          baseVersionNumber: null,
        },
      ],
    });

    // No excludePathPrefixes provided by caller — _registry must STILL be filtered.
    const preview = await previewMerge('source-branch', 'main-branch');

    expect(preview.conflicts.documentConflicts).toHaveLength(1);
    expect(preview.conflicts.documentConflicts[0]?.documentPath).toBe('pages/home');
    expect(preview.sourceChanges).toHaveLength(1);
    expect(preview.sourceChanges[0]?.documentPath).toBe('pages/home');
    expect(preview.targetChanges).toHaveLength(1);
    expect(preview.targetChanges[0]?.documentPath).toBe('pages/home');
  });

  it('combines system-managed exclusions with caller-provided excludePathPrefixes', async () => {
    const { previewMerge } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );

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
          documentId: 'doc-real',
          documentPath: 'pages/home',
          latestVersionId: 'v-real',
          latestVersionNumber: 3,
          baseVersionId: null,
          baseVersionNumber: null,
        },
        {
          documentId: 'doc-registry',
          documentPath: '_registry/components/Hero',
          latestVersionId: 'v-reg',
          latestVersionNumber: 3,
          baseVersionId: null,
          baseVersionNumber: null,
        },
        {
          documentId: 'doc-drafts',
          documentPath: 'drafts/wip',
          latestVersionId: 'v-draft',
          latestVersionNumber: 1,
          baseVersionId: null,
          baseVersionNumber: null,
        },
      ],
      targetChanges: [],
    });

    // Caller asks to exclude drafts/. System still excludes _registry.
    // Final result: only pages/home survives.
    const preview = await previewMerge('source-branch', 'main-branch', {
      excludePathPrefixes: ['drafts/'],
    });

    expect(preview.sourceChanges).toHaveLength(1);
    expect(preview.sourceChanges[0]?.documentPath).toBe('pages/home');
  });

  it('keeps non-system underscore prefixes (e.g. _translations/) in the merge', async () => {
    // Sanity check: only `_registry/` is system-managed. Other underscore-
    // prefixed paths like `_translations/` or `_structure/` are user content
    // and must continue to merge normally.
    const { previewMerge } = await import(
      '../../src/services/merge-execution-service'
    );
    const conflictDetection = await import(
      '../../src/services/conflict-detection-service'
    );

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
          documentId: 'doc-translations',
          documentPath: '_translations/es/home',
          latestVersionId: 'v-trans',
          latestVersionNumber: 1,
          baseVersionId: null,
          baseVersionNumber: null,
        },
        {
          documentId: 'doc-structure',
          documentPath: '_structure/menu',
          latestVersionId: 'v-struct',
          latestVersionNumber: 1,
          baseVersionId: null,
          baseVersionNumber: null,
        },
      ],
      targetChanges: [],
    });

    const preview = await previewMerge('source-branch', 'main-branch');

    expect(preview.sourceChanges).toHaveLength(2);
    const paths = preview.sourceChanges.map((c) => c.documentPath).sort();
    expect(paths).toEqual(['_structure/menu', '_translations/es/home']);
  });
});
