/**
 * useMergeResolution Hook - Execute Tests
 *
 * Tests the executeMerge method: strategy-to-backend mapping and execution flow.
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

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient() {
  return {
    merge: {
      checkMergeability: vi.fn(),
      preview: vi.fn(),
      crdtPreview: vi.fn(),
      execute: vi.fn(),
      createRequest: vi.fn(),
      getRequest: vi.fn(),
      listRequests: vi.fn(),
      updateRequest: vi.fn(),
      deleteRequest: vi.fn(),
      executeRequest: vi.fn(),
    },
    sites: {},
    branches: {},
    documents: {},
    versions: {},
    checkpoints: {},
    presence: {},
    agentRegistry: {},
    agentEdit: {},
  } as unknown as UseMergeResolutionOptions['client'];
}

function createMergePreview() {
  return {
    canMerge: true,
    hasConflicts: true,
    conflicts: {
      documentConflicts: [
        { documentId: 'doc-1', documentPath: '/home', conflictType: 'both-modified' },
        { documentId: 'doc-2', documentPath: '/about', conflictType: 'both-modified' },
        { documentId: 'doc-3', documentPath: '/contact', conflictType: 'both-modified' },
        { documentId: 'doc-4', documentPath: '/blog', conflictType: 'both-modified' },
      ],
      structureConflicts: [],
    },
    sourceChanges: [
      { documentId: 'doc-1', documentPath: '/home' },
      { documentId: 'doc-2', documentPath: '/about' },
      { documentId: 'doc-3', documentPath: '/contact' },
      { documentId: 'doc-4', documentPath: '/blog' },
    ],
    targetChanges: [
      { documentId: 'doc-1', documentPath: '/home' },
      { documentId: 'doc-2', documentPath: '/about' },
      { documentId: 'doc-3', documentPath: '/contact' },
      { documentId: 'doc-4', documentPath: '/blog' },
    ],
    mergeBase: { checkpointId: 'cp-1', branchId: 'branch-target' },
    documentDiffs: [
      {
        documentId: 'doc-1',
        documentPath: '/home',
        sourceSnapshot: { content: [], root: {} },
        targetSnapshot: { content: [], root: {} },
        diffOperations: [],
      },
      {
        documentId: 'doc-2',
        documentPath: '/about',
        sourceSnapshot: { content: [], root: {} },
        targetSnapshot: { content: [], root: {} },
        diffOperations: [],
      },
      {
        documentId: 'doc-3',
        documentPath: '/contact',
        sourceSnapshot: { content: [], root: {} },
        targetSnapshot: { content: [], root: {} },
        diffOperations: [],
      },
      {
        documentId: 'doc-4',
        documentPath: '/blog',
        sourceSnapshot: { content: [], root: {} },
        targetSnapshot: { content: [], root: {} },
        diffOperations: [],
      },
    ],
  };
}

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

describe('useMergeResolution - executeMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps accept-draft to take-source', async () => {
    const mockClient = createMockClient();
    mockClient.merge.preview.mockResolvedValue(createMergePreview());
    mockClient.merge.execute.mockResolvedValue({ success: true, checkpointId: 'cp-2', documentsUpdated: 4 });
    const options = createOptions(mockClient);

    const { result } = renderHook(() => useMergeResolution(options));

    await act(async () => {
      await result.current.loadPreview();
    });

    act(() => {
      result.current.setAllStrategy('accept-draft');
    });

    await act(async () => {
      await result.current.executeMerge('Test merge');
    });

    const call = mockClient.merge.execute.mock.calls[0];
    const resolutions = call[1].conflictResolutions;
    expect(resolutions[0].strategy).toBe('take-source');
  });

  it('maps accept-live to take-target', async () => {
    const mockClient = createMockClient();
    mockClient.merge.preview.mockResolvedValue(createMergePreview());
    mockClient.merge.execute.mockResolvedValue({ success: true, checkpointId: 'cp-2', documentsUpdated: 4 });
    const options = createOptions(mockClient);

    const { result } = renderHook(() => useMergeResolution(options));

    await act(async () => {
      await result.current.loadPreview();
    });

    act(() => {
      result.current.setAllStrategy('accept-live');
    });

    await act(async () => {
      await result.current.executeMerge();
    });

    const call = mockClient.merge.execute.mock.calls[0];
    const resolutions = call[1].conflictResolutions;
    expect(resolutions[0].strategy).toBe('take-target');
  });

  it('maps cherry-pick to manual with resolvedSnapshot', async () => {
    const mockClient = createMockClient();
    mockClient.merge.preview.mockResolvedValue(createMergePreview());
    mockClient.merge.execute.mockResolvedValue({ success: true, checkpointId: 'cp-2', documentsUpdated: 4 });
    const options = createOptions(mockClient);

    const { result } = renderHook(() => useMergeResolution(options));

    await act(async () => {
      await result.current.loadPreview();
    });

    act(() => {
      result.current.setStrategy('doc-1', 'cherry-pick');
    });

    // Set cherry-pick selection
    act(() => {
      result.current.setCherryPickSelection('doc-1', 'h1', 'text', 'source');
    });

    // Set remaining to accept-draft to resolve all
    act(() => {
      result.current.setRemainingStrategy('accept-draft');
    });

    await act(async () => {
      await result.current.executeMerge();
    });

    const call = mockClient.merge.execute.mock.calls[0];
    const resolutions = call[1].conflictResolutions;
    const cherryPickRes = resolutions.find((r: { documentId: string }) => r.documentId === 'doc-1');
    expect(cherryPickRes.strategy).toBe('manual');
    expect(cherryPickRes.resolvedSnapshot).toBeDefined();
  });

  it('maps crdt-preview to merge-crdt', async () => {
    const mockClient = createMockClient();
    mockClient.merge.preview.mockResolvedValue(createMergePreview());
    mockClient.merge.crdtPreview.mockResolvedValue({ success: true, snapshot: { content: [], root: {} } });
    mockClient.merge.execute.mockResolvedValue({ success: true, checkpointId: 'cp-2', documentsUpdated: 4 });
    const options = createOptions(mockClient);

    const { result } = renderHook(() => useMergeResolution(options));

    await act(async () => {
      await result.current.loadPreview();
    });

    act(() => {
      result.current.setStrategy('doc-1', 'crdt-preview');
    });

    // Resolve remaining
    act(() => {
      result.current.setRemainingStrategy('accept-draft');
    });

    await act(async () => {
      await result.current.executeMerge();
    });

    const call = mockClient.merge.execute.mock.calls[0];
    const resolutions = call[1].conflictResolutions;
    const crdtRes = resolutions.find((r: { documentId: string }) => r.documentId === 'doc-1');
    expect(crdtRes.strategy).toBe('merge-crdt');
  });

  it('sets mergeSuccess on success', async () => {
    const mockClient = createMockClient();
    mockClient.merge.preview.mockResolvedValue(createMergePreview());
    mockClient.merge.execute.mockResolvedValue({ success: true, checkpointId: 'cp-2', documentsUpdated: 4 });
    const options = createOptions(mockClient);

    const { result } = renderHook(() => useMergeResolution(options));

    await act(async () => {
      await result.current.loadPreview();
    });

    act(() => {
      result.current.setAllStrategy('accept-draft');
    });

    await act(async () => {
      await result.current.executeMerge();
    });

    expect(result.current.mergeSuccess).toBe(true);
    expect(result.current.mergeExecuting).toBe(false);
  });

  it('throws error for unresolved documents instead of silent fallback', async () => {
    const mockClient = createMockClient();
    mockClient.merge.preview.mockResolvedValue(createMergePreview());
    mockClient.merge.execute.mockResolvedValue({ success: true });
    const options = createOptions(mockClient);

    const { result } = renderHook(() => useMergeResolution(options));

    await act(async () => {
      await result.current.loadPreview();
    });

    // Do NOT resolve all documents — leave them unresolved
    await act(async () => {
      await result.current.executeMerge();
    });

    // Should set mergeError because documents are still unresolved
    expect(result.current.mergeError).toMatch(/still unresolved/);
    expect(result.current.mergeSuccess).toBe(false);
    expect(mockClient.merge.execute).not.toHaveBeenCalled();
  });

  it('sets mergeError on failure', async () => {
    const mockClient = createMockClient();
    mockClient.merge.preview.mockResolvedValue(createMergePreview());
    mockClient.merge.execute.mockRejectedValue(new Error('Merge failed'));
    const options = createOptions(mockClient);

    const { result } = renderHook(() => useMergeResolution(options));

    await act(async () => {
      await result.current.loadPreview();
    });

    act(() => {
      result.current.setAllStrategy('accept-draft');
    });

    await act(async () => {
      await result.current.executeMerge();
    });

    expect(result.current.mergeError).toBe('Merge failed');
    expect(result.current.mergeSuccess).toBe(false);
  });
});
