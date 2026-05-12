/**
 * useBranches Hook Tests
 *
 * Tests that archived and merged branches are filtered out,
 * the main branch is always included, and currentBranch resolves correctly.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBranches } from '../src/editor/useBranches.js';
import type { P1Client, Branch } from '@pantheon-systems/css-client';

/** Helper to build a Branch object with sensible defaults. */
function makeBranch(overrides: Partial<Branch> & { id: string }): Branch {
  return {
    siteId: 'site1',
    name: overrides.id,
    isMain: false,
    status: 'active',
    sourceBranchId: null,
    sourceCheckpointId: null,
    createdById: 'user1',
    createdByType: 'user',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useBranches', () => {
  const mockClient = {
    branches: {
      list: vi.fn(),
    },
  } as unknown as P1Client;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should filter out archived branches', async () => {
    const branches: Branch[] = [
      makeBranch({ id: 'main-1', name: 'main', isMain: true, status: 'active' }),
      makeBranch({ id: 'feature-1', name: 'feature', status: 'active' }),
      makeBranch({ id: 'old-1', name: 'old-branch', status: 'archived' }),
    ];

    (mockClient.branches.list as ReturnType<typeof vi.fn>).mockResolvedValue(branches);

    const { result } = renderHook(() =>
      useBranches({
        client: mockClient,
        siteId: 'site1',
        initialBranchId: 'main-1',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const ids = result.current.branches.map((b) => b.id);
    expect(ids).toContain('main-1');
    expect(ids).toContain('feature-1');
    expect(ids).not.toContain('old-1');
  });

  it('should filter out merged branches', async () => {
    const branches: Branch[] = [
      makeBranch({ id: 'main-1', name: 'main', isMain: true, status: 'active' }),
      makeBranch({ id: 'feature-1', name: 'feature', status: 'active' }),
      makeBranch({ id: 'merged-1', name: 'merged-branch', status: 'merged' }),
    ];

    (mockClient.branches.list as ReturnType<typeof vi.fn>).mockResolvedValue(branches);

    const { result } = renderHook(() =>
      useBranches({
        client: mockClient,
        siteId: 'site1',
        initialBranchId: 'main-1',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const ids = result.current.branches.map((b) => b.id);
    expect(ids).toContain('main-1');
    expect(ids).toContain('feature-1');
    expect(ids).not.toContain('merged-1');
  });

  it('should always include the main branch regardless of status', async () => {
    // Edge case: main branch has a non-active status (should not happen
    // in practice, but the main branch must always be visible).
    const branches: Branch[] = [
      makeBranch({ id: 'main-1', name: 'main', isMain: true, status: 'merged' }),
      makeBranch({ id: 'feature-1', name: 'feature', status: 'active' }),
    ];

    (mockClient.branches.list as ReturnType<typeof vi.fn>).mockResolvedValue(branches);

    const { result } = renderHook(() =>
      useBranches({
        client: mockClient,
        siteId: 'site1',
        initialBranchId: 'main-1',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const ids = result.current.branches.map((b) => b.id);
    expect(ids).toContain('main-1');
    expect(ids).toContain('feature-1');
  });

  it('should resolve currentBranch correctly after filtering', async () => {
    const branches: Branch[] = [
      makeBranch({ id: 'main-1', name: 'main', isMain: true, status: 'active' }),
      makeBranch({ id: 'feature-1', name: 'feature', status: 'active' }),
      makeBranch({ id: 'archived-1', name: 'archived', status: 'archived' }),
    ];

    (mockClient.branches.list as ReturnType<typeof vi.fn>).mockResolvedValue(branches);

    const { result } = renderHook(() =>
      useBranches({
        client: mockClient,
        siteId: 'site1',
        initialBranchId: 'feature-1',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currentBranch).not.toBeNull();
    expect(result.current.currentBranch?.id).toBe('feature-1');
    expect(result.current.branchId).toBe('feature-1');
    // Archived branch should not be in the list
    expect(result.current.branches.find((b) => b.id === 'archived-1')).toBeUndefined();
  });
});
