import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../auth/P1AuthProvider', () => ({
  useP1Auth: () => ({ getToken: () => Promise.resolve('test-token') }),
}));

import { P1RouterContext, type P1Router } from '../../p1/router-context';
import { useCreateStructure, useDeleteStructurePage } from '../../p1/pages/hooks';
import { P1QueryProvider } from '../../data/query-provider';

function createMockRouter(): P1Router {
  return {
    refresh: vi.fn(),
    replace: vi.fn(),
    pathname: '/structure',
    searchParams: new URLSearchParams(),
  };
}

function createWrapper(router: P1Router) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1QueryProvider,
      null,
      React.createElement(
        P1RouterContext.Provider,
        { value: router },
        children
      )
    );
  };
}

describe('pages hooks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useCreateStructure', () => {
    it('POSTs to /p1/api/structure/:kind and calls refresh on success', async () => {
      const router = createMockRouter();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, path: '/new-page' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { result } = renderHook(() => useCreateStructure('page'), {
        wrapper: createWrapper(router),
      });

      result.current.mutate('/new-page');
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        '/p1/api/structure/page',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('/new-page'),
        }),
      );
      expect(router.refresh).toHaveBeenCalled();
    });

    it('throws on failed response', async () => {
      const router = createMockRouter();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Path already exists' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { result } = renderHook(() => useCreateStructure('page'), {
        wrapper: createWrapper(router),
      });

      result.current.mutate('/existing');
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Path already exists');
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });

  describe('useDeleteStructurePage', () => {
    it('DELETEs to /p1/api/structure/page and calls refresh on success', async () => {
      const router = createMockRouter();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, deletedPaths: ['/old-page'] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { result } = renderHook(() => useDeleteStructurePage(), {
        wrapper: createWrapper(router),
      });

      result.current.mutate('/old-page');
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        '/p1/api/structure/page',
        expect.objectContaining({
          method: 'DELETE',
          body: expect.stringContaining('/old-page'),
        }),
      );
      expect(router.refresh).toHaveBeenCalled();
    });
  });
});
