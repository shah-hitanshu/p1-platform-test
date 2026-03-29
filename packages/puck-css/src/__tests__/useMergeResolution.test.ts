/**
 * useMergeResolution Hook Tests
 *
 * Tests the state machine hook for multi-document merge conflict resolution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the puckFieldClassifier module
vi.mock('../utils/puckFieldClassifier.js', () => ({
  classifyPuckFields: vi.fn().mockReturnValue([
    {
      classification: 'conflicting',
      componentId: 'h1',
      componentType: 'Heading',
      propName: 'text',
      sourceValue: 'Source',
      targetValue: 'Target',
      path: 'content',
    },
  ]),
  buildMergedSnapshot: vi.fn().mockReturnValue({
    content: [{ type: 'Heading', props: { id: 'h1', text: 'Merged' } }],
    root: { props: {} },
  }),
}));

import { useMergeResolution } from '../hooks/useMergeResolution.js';
import type { UseMergeResolutionOptions } from '../hooks/useMergeResolution.js';
import { classifyPuckFields } from '../utils/puckFieldClassifier.js';

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient() {
  return {
    merge: {
      checkMergeability: vi.fn(),
      preview: vi.fn(),
      execute: vi.fn(),
      createRequest: vi.fn(),
      getRequest: vi.fn(),
      listRequests: vi.fn(),
      updateRequest: vi.fn(),
      deleteRequest: vi.fn(),
      executeRequest: vi.fn(),
    },
    // Other endpoints (not used but needed for type compatibility)
    sites: {},
    branches: {},
    documents: {},
    versions: {
      getLatest: vi.fn().mockResolvedValue({
        id: 'ver-1',
        documentId: 'doc-unknown',
        branchId: 'branch-unknown',
        versionNumber: 1,
        snapshot: { content: [], root: {} },
        crdtState: null,
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: new Date().toISOString(),
      }),
    },
    checkpoints: {},
    presence: {},
    agentRegistry: {},
    agentEdit: {},
  } as unknown as UseMergeResolutionOptions['client'];
}

// =============================================================================
// Mock Merge Preview Factory
// =============================================================================

function createMergePreview(overrides: Record<string, unknown> = {}) {
  return {
    canMerge: true,
    hasConflicts: true,
    conflicts: {
      documentConflicts: [
        {
          documentId: 'doc-1',
          documentPath: '/home',
          conflictType: 'both-modified',
        },
      ],
      structureConflicts: [],
    },
    sourceChanges: [
      { documentId: 'doc-1', documentPath: '/home' },
      { documentId: 'doc-2', documentPath: '/about' },
    ],
    targetChanges: [
      { documentId: 'doc-1', documentPath: '/home' },
      { documentId: 'doc-3', documentPath: '/contact' },
    ],
    mergeBase: { checkpointId: 'cp-1', branchId: 'branch-target' },
    documentDiffs: [
      {
        documentId: 'doc-1',
        documentPath: '/home',
        sourceSnapshot: { content: [{ type: 'Heading', props: { id: 'h1', text: 'Source' } }], root: {} },
        targetSnapshot: { content: [{ type: 'Heading', props: { id: 'h1', text: 'Target' } }], root: {} },
        diffOperations: [],
      },
      {
        documentId: 'doc-2',
        documentPath: '/about',
        sourceSnapshot: { content: [], root: {} },
        targetSnapshot: null,
        diffOperations: [],
      },
      {
        documentId: 'doc-3',
        documentPath: '/contact',
        sourceSnapshot: null,
        targetSnapshot: { content: [], root: {} },
        diffOperations: [],
      },
    ],
    ...overrides,
  };
}

// =============================================================================
// Default Hook Options
// =============================================================================

function createOptions(client?: ReturnType<typeof createMockClient>): UseMergeResolutionOptions {
  return {
    client: client ?? createMockClient(),
    siteId: 'site-1',
    sourceBranchId: 'branch-source',
    targetBranchId: 'branch-target',
    sourceBranchName: 'Draft',
    targetBranchName: 'Live',
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useMergeResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadPreview', () => {
    it('calls client.merge.preview with correct params', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      expect(mockClient.merge.preview).toHaveBeenCalledWith(
        'site-1',
        'branch-source',
        'branch-target',
        { includeContent: true }
      );
    });

    it('populates documents array from documentDiffs', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      // Only conflicts and source changes are shown (target-only changes excluded)
      expect(result.current.documents).toHaveLength(2);
      expect(result.current.documents[0].documentId).toBe('doc-1');
      expect(result.current.documents[0].documentPath).toBe('/home');
      expect(result.current.documents[1].documentId).toBe('doc-2');
    });

    it('sets source-only changes to accept-draft', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      // doc-2 is in sourceChanges but not in conflicts => accept-draft
      const doc2 = result.current.documents.find((d) => d.documentId === 'doc-2');
      expect(doc2?.strategy).toBe('accept-draft');
    });

    it('excludes target-only changes from document list', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      // doc-3 is only in targetChanges — should not appear in the list
      const doc3 = result.current.documents.find((d) => d.documentId === 'doc-3');
      expect(doc3).toBeUndefined();
    });

    it('sets conflicting documents to unresolved', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      // doc-1 is in conflicts => unresolved
      const doc1 = result.current.documents.find((d) => d.documentId === 'doc-1');
      expect(doc1?.strategy).toBe('unresolved');
    });

    it('sets previewError on API failure', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockRejectedValue(new Error('API failure'));
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      expect(result.current.previewError).toBe('API failure');
      expect(result.current.documents).toHaveLength(0);
    });
  });

  describe('setStrategy', () => {
    it('updates a single document strategy', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      act(() => {
        result.current.setStrategy('doc-1', 'accept-draft');
      });

      const doc1 = result.current.documents.find((d) => d.documentId === 'doc-1');
      expect(doc1?.strategy).toBe('accept-draft');
    });

    it('to cherry-pick populates classifiedFields', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      act(() => {
        result.current.setStrategy('doc-1', 'cherry-pick');
      });

      expect(classifyPuckFields).toHaveBeenCalled();
      const doc1 = result.current.documents.find((d) => d.documentId === 'doc-1');
      expect(doc1?.classifiedFields).toBeDefined();
      expect(doc1?.classifiedFields?.length).toBeGreaterThan(0);
    });

    it('disallows cherry-pick for deleted-in-source conflicts', async () => {
      const mockClient = createMockClient();
      const preview = createMergePreview({
        conflicts: {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: '/home',
              conflictType: 'deleted-in-source',
            },
          ],
          structureConflicts: [],
        },
      });
      mockClient.merge.preview.mockResolvedValue(preview);
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      act(() => {
        result.current.setStrategy('doc-1', 'cherry-pick');
      });

      const doc1 = result.current.documents.find((d) => d.documentId === 'doc-1');
      expect(doc1?.strategy).toBe('unresolved');
    });

  });

  describe('bulk operations', () => {
    it('setAllStrategy sets all documents to the given strategy', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      act(() => {
        result.current.setAllStrategy('accept-draft');
      });

      for (const doc of result.current.documents) {
        expect(doc.strategy).toBe('accept-draft');
      }
    });

    it('setRemainingStrategy only changes unresolved documents', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      // doc-2 is already accept-draft (source-only change)
      // Only doc-1 is unresolved (conflict)
      act(() => {
        result.current.setRemainingStrategy('accept-live');
      });

      const doc1 = result.current.documents.find((d) => d.documentId === 'doc-1');
      expect(doc1?.strategy).toBe('accept-live');

      // Pre-resolved ones should keep their strategies
      const doc2 = result.current.documents.find((d) => d.documentId === 'doc-2');
      expect(doc2?.strategy).toBe('accept-draft');
    });
  });

  describe('navigation', () => {
    it('goToNext increments currentIndex', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.goToNext();
      });

      expect(result.current.currentIndex).toBe(1);
    });

    it('goToPrevious decrements currentIndex', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      act(() => {
        result.current.goToDocument(1);
      });

      expect(result.current.currentIndex).toBe(1);

      act(() => {
        result.current.goToPrevious();
      });

      expect(result.current.currentIndex).toBe(0);

      // Should not go below 0
      act(() => {
        result.current.goToPrevious();
      });

      expect(result.current.currentIndex).toBe(0);
    });

    it('goToNextUnresolved skips resolved documents', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      // doc-1 is unresolved (index 0), doc-2 is accept-draft (index 1), doc-3 is accept-live (index 2)
      // Starting at 0, next unresolved after 0 should wrap around (no other unresolved)
      // First resolve doc-1 so we can test wrapping
      act(() => {
        result.current.setStrategy('doc-1', 'accept-draft');
      });

      // Now nothing is unresolved, goToNextUnresolved should not change index
      act(() => {
        result.current.goToNextUnresolved();
      });

      // When nothing is unresolved, index stays same
      expect(result.current.currentIndex).toBe(0);
    });

    it('goToNextUnresolved wraps around', async () => {
      const mockClient = createMockClient();
      // Create preview with 2 conflicting docs
      const preview = createMergePreview({
        conflicts: {
          documentConflicts: [
            { documentId: 'doc-1', documentPath: '/home', conflictType: 'both-modified' },
            { documentId: 'doc-3', documentPath: '/contact', conflictType: 'both-modified' },
          ],
          structureConflicts: [],
        },
      });
      mockClient.merge.preview.mockResolvedValue(preview);
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      // doc-1 (index 0) unresolved, doc-2 (index 1) accept-draft, doc-3 (index 2) unresolved
      // Go to index 2
      act(() => {
        result.current.goToDocument(2);
      });

      // Next unresolved from index 2 should wrap to index 0
      act(() => {
        result.current.goToNextUnresolved();
      });

      expect(result.current.currentIndex).toBe(0);
    });
  });

  describe('counts', () => {
    it('resolvedCount and unresolvedCount track strategy changes', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      // doc-2 is accept-draft (source-only) => 1 resolved, doc-1 unresolved (conflict)
      expect(result.current.resolvedCount).toBe(1);
      expect(result.current.unresolvedCount).toBe(1);

      act(() => {
        result.current.setStrategy('doc-1', 'accept-draft');
      });

      expect(result.current.resolvedCount).toBe(2);
      expect(result.current.unresolvedCount).toBe(0);
    });

    it('allResolved is true only when no documents are unresolved', async () => {
      const mockClient = createMockClient();
      mockClient.merge.preview.mockResolvedValue(createMergePreview());
      const options = createOptions(mockClient);

      const { result } = renderHook(() => useMergeResolution(options));

      await act(async () => {
        await result.current.loadPreview();
      });

      expect(result.current.allResolved).toBe(false);

      act(() => {
        result.current.setStrategy('doc-1', 'accept-live');
      });

      expect(result.current.allResolved).toBe(true);
    });
  });

});
