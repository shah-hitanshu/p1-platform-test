/**
 * Tests for P1PuckProvider's branchResolutionError.
 *
 * The editor cannot open a document without a branch, so both ways of ending up
 * without one — a refused branch list, and a list that resolves empty — have to
 * reach the context instead of leaving consumers on a loading state forever.
 * The empty case is reachable in practice: the branches endpoint answers a
 * nonexistent site with an empty list, not a 404.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const TEST_SITE_ID = 'site-branch-error-test';

vi.mock('../editor/useRealtime', () => ({
  useRealtime: () => ({
    connected: false,
    provider: null,
    awareness: null,
    doc: null,
    connectionError: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('../editor/useDocuments', () => ({
  useDocuments: () => ({
    documents: [],
    loading: false,
  }),
}));

vi.mock('../core/utils/retry', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

function createMockClient(branchesList: () => Promise<unknown>) {
  const principalClient = {
    branches: { list: vi.fn(branchesList), create: vi.fn(), delete: vi.fn() },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getByPath: vi.fn(),
      getOrCreate: vi.fn(),
      update: vi.fn(),
    },
    checkpoints: { create: vi.fn() },
    versions: { list: vi.fn().mockResolvedValue([]), getLatest: vi.fn(), create: vi.fn() },
    sites: { get: vi.fn().mockRejectedValue(new Error('no site metadata')) },
  };

  return { withPrincipal: vi.fn().mockReturnValue(principalClient) };
}

import { P1PuckProvider } from '../editor/P1PuckProvider.js';
import { useP1Puck } from '../core/P1PuckContext.js';

function ErrorConsumer() {
  const { branchId, branchResolutionError } = useP1Puck();
  return (
    <div>
      <span data-testid="branch-id">{branchId}</span>
      <span data-testid="branch-error">{branchResolutionError?.message ?? 'none'}</span>
    </div>
  );
}

function renderWithClient(client: ReturnType<typeof createMockClient>) {
  return render(
    <P1PuckProvider client={client as never} siteId={TEST_SITE_ID} userId="user-1">
      <ErrorConsumer />
    </P1PuckProvider>
  );
}

describe('P1PuckProvider branchResolutionError', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('reports a refused branch list with the request and its status', async () => {
    const refused = Object.assign(new Error('Insufficient scope for this operation'), { status: 403 });
    renderWithClient(createMockClient(() => Promise.reject(refused)));

    await waitFor(() => {
      expect(screen.getByTestId('branch-error').textContent).not.toBe('none');
    });

    const message = screen.getByTestId('branch-error').textContent ?? '';
    expect(message).toContain(`GET /api/sites/${TEST_SITE_ID}/branches`);
    expect(message).toContain('403');
    expect(message).toContain('Insufficient scope for this operation');
  });

  it('reports a branch list that resolves without a usable branch', async () => {
    renderWithClient(createMockClient(() => Promise.resolve([])));

    await waitFor(() => {
      expect(screen.getByTestId('branch-error').textContent).not.toBe('none');
    });

    expect(screen.getByTestId('branch-error').textContent).toContain('no usable branch');
    expect(screen.getByTestId('branch-id').textContent).toBe('');
  });

  it('stays clear when a branch resolves', async () => {
    const branches = [
      {
        id: 'branch-main',
        name: 'main',
        isMain: true,
        siteId: TEST_SITE_ID,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    renderWithClient(createMockClient(() => Promise.resolve(branches)));

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe('branch-main');
    });

    expect(screen.getByTestId('branch-error').textContent).toBe('none');
  });
});
