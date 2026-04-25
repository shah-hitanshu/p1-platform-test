/**
 * Tests for site name fetching in CSSPuckProvider.
 *
 * Validates:
 * - Provider fetches site name on mount and exposes it via useCSSPuck()
 * - siteName is null before the fetch completes
 * - siteName stays null when the fetch fails
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_SITE_ID = 'site-abc-123';
const TEST_SITE_NAME = 'Airbus Migration';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../hooks/useRealtime', () => ({
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

vi.mock('../hooks/useDocuments', () => ({
  useDocuments: () => ({
    documents: [],
    loading: false,
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock('../utils/debounce', () => ({
  debounce: (fn: (...args: unknown[]) => unknown) => {
    const debounced = fn as ((...args: unknown[]) => unknown) & {
      cancel: () => void;
      flush: () => void;
    };
    debounced.cancel = vi.fn();
    debounced.flush = vi.fn();
    return debounced;
  },
}));

vi.mock('../utils/retry', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

function createMockClient(siteName: string | null = TEST_SITE_NAME) {
  const principalClient = {
    branches: {
      list: vi.fn().mockResolvedValue([{
        id: 'branch-main',
        name: 'main',
        isMain: true,
        siteId: TEST_SITE_ID,
        createdAt: '2026-01-01T00:00:00Z',
      }]),
      create: vi.fn(),
      delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getOrCreate: vi.fn(),
      update: vi.fn(),
    },
    checkpoints: { create: vi.fn() },
    versions: { list: vi.fn().mockResolvedValue([]) },
  };

  return {
    withPrincipal: vi.fn().mockReturnValue(principalClient),
    _principalClient: principalClient,
    sites: {
      get: siteName !== null
        ? vi.fn().mockResolvedValue({ id: TEST_SITE_ID, name: siteName, pantheonSiteId: 'p-abc', workflowSettings: {}, createdAt: '', updatedAt: '' })
        : vi.fn().mockRejectedValue(new Error('Not found')),
    },
  };
}

// ---------------------------------------------------------------------------
// Imports (must come after mocks)
// ---------------------------------------------------------------------------

import { CSSPuckProvider } from '../CSSPuckProvider.js';
import { useCSSPuck } from '../CSSPuckContext.js';

// ---------------------------------------------------------------------------
// Helper consumer component
// ---------------------------------------------------------------------------

function SiteNameConsumer() {
  const { siteName } = useCSSPuck();
  return <span data-testid="site-name">{siteName ?? 'null'}</span>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CSSPuckProvider — site name', () => {
  it('exposes siteName from the fetched site after mount', async () => {
    const client = createMockClient(TEST_SITE_NAME);

    render(
      <CSSPuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <SiteNameConsumer />
      </CSSPuckProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('site-name').textContent).toBe(TEST_SITE_NAME);
    });

    expect(client.sites.get).toHaveBeenCalledWith(TEST_SITE_ID);
  });

  it('siteName remains null when the fetch fails', async () => {
    const client = createMockClient(null); // mocked to reject

    render(
      <CSSPuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <SiteNameConsumer />
      </CSSPuckProvider>
    );

    // Give the fetch time to fail
    await waitFor(() => {
      expect(client.sites.get).toHaveBeenCalled();
    });

    expect(screen.getByTestId('site-name').textContent).toBe('null');
  });
});
