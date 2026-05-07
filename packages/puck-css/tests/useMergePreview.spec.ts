import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMergePreview } from '../src/editor/useMergePreview.js';

// Mock useCSSPuck
const mockUseCSSPuck = vi.fn();
vi.mock('../src/core/CSSPuckContext.js', () => ({
  useCSSPuck: () => mockUseCSSPuck(),
}));

const mainBranch = { id: 'main-id', name: 'Live', isMain: true };
const featureBranch = { id: 'feature-id', name: 'my-feature', isMain: false };

const mockDocumentDiffs = [
  {
    documentId: 'doc-1',
    documentPath: '/pages/home',
    sourceSnapshot: { content: [], root: { props: {} } },
    targetSnapshot: { content: [], root: { props: {} } },
    diffOperations: [],
  },
];

function makeMockContext(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      merge: {
        preview: vi.fn().mockResolvedValue({ documentDiffs: mockDocumentDiffs }),
      },
    },
    siteId: 'site-1',
    branchId: featureBranch.id,
    currentBranch: featureBranch,
    branches: [mainBranch, featureBranch],
    branchesLoading: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCSSPuck.mockReturnValue(makeMockContext());
});

describe('useMergePreview', () => {
  it('fetches comparison between current branch and main on mount', async () => {
    const ctx = makeMockContext();
    mockUseCSSPuck.mockReturnValue(ctx);

    const { result } = renderHook(() => useMergePreview());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(ctx.client.merge.preview).toHaveBeenCalledWith(
      'site-1',
      featureBranch.id,
      mainBranch.id,
      { includeContent: true, excludePathPrefixes: ['_registry/'] },
    );

    expect(result.current.documents).toHaveLength(1);
    expect(result.current.documents[0].documentPath).toBe('/pages/home');
  });

  it('uses branch names from context', async () => {
    const { result } = renderHook(() => useMergePreview());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sourceBranchName).toBe('my-feature');
    expect(result.current.targetBranchName).toBe('Live');
  });

  it('skips fetch and returns isMainBranch=true when on main', async () => {
    mockUseCSSPuck.mockReturnValue(
      makeMockContext({
        branchId: mainBranch.id,
        currentBranch: mainBranch,
      }),
    );

    const { result } = renderHook(() => useMergePreview());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isMainBranch).toBe(true);
    expect(result.current.documents).toHaveLength(0);
  });

  it('stays loading while branchesLoading is true', () => {
    mockUseCSSPuck.mockReturnValue(makeMockContext({ branchesLoading: true }));

    const { result } = renderHook(() => useMergePreview());

    expect(result.current.loading).toBe(true);
  });

  it('sets error state when fetch fails', async () => {
    const ctx = makeMockContext();
    ctx.client.merge.preview = vi.fn().mockRejectedValue(new Error('Network error'));
    mockUseCSSPuck.mockReturnValue(ctx);

    const { result } = renderHook(() => useMergePreview());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
    expect(result.current.documents).toHaveLength(0);
  });
});
