import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { P1RouterContext, type P1Router } from '../../p1/router-context';
import { usePublish, useLoadPageData } from '../../p1/editor/hooks';
import { P1QueryProvider } from '../../data/query-provider';

function createMockRouter(): P1Router {
  return {
    refresh: vi.fn(),
    replace: vi.fn(),
    pathname: '/test',
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

describe('editor hooks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('usePublish', () => {
    it('POSTs data to /p1/api/publish', async () => {
      const router = createMockRouter();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { result } = renderHook(() => usePublish('/test'), {
        wrapper: createWrapper(router),
      });

      result.current.mutate({ content: [], root: { props: {} }, zones: {} } as never);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        '/p1/api/publish',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"path":"/test"'),
        }),
      );
    });
  });

  describe('useLoadPageData', () => {
    it('fetches page data by path', async () => {
      const router = createMockRouter();
      const pageData = { content: [], root: { props: { title: 'Page' } }, zones: {} };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: pageData }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { result } = renderHook(() => useLoadPageData(), {
        wrapper: createWrapper(router),
      });

      result.current.mutate('/about');
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(pageData);
      expect(mockFetch).toHaveBeenCalledWith(
        '/p1/api/page-data?path=%2Fabout',
      );
    });
  });
});
