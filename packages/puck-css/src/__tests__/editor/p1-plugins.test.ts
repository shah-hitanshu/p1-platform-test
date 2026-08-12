import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { P1RouterContext, type P1Router } from '../../p1/router-context';
import { useEditorContext, useP1Plugins, useRemoteDatasourceContext } from '../../p1/editor/hooks';
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

const MOCK_EDITOR_CONTEXT = {
  remoteDatasourceContext: {},
  routes: [{ path: '/', kind: 'page' as const }],
  routeTemplateKeys: ['/jedi/:id'],
  savedPreviewParams: { id: '5' },
  remoteDatasourceRegistry: [
    {
      id: 'swapi',
      label: 'SWAPI',
      description: 'test',
      resolution: 'test',
      fields: [{ path: 'name', description: 'Name' }],
    },
  ],
};

describe('useEditorContext', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches editor context from /p1/api/editor-context', async () => {
    const router = createMockRouter();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_EDITOR_CONTEXT),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useEditorContext('/contact-us'), {
      wrapper: createWrapper(router),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith(
      '/p1/api/editor-context?path=%2Fcontact-us',
    );
    expect(result.current.data).toEqual(MOCK_EDITOR_CONTEXT);
  });
});

describe('useRemoteDatasourceContext', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty context and loading when registry is empty', () => {
    const router = createMockRouter();
    const { result } = renderHook(
      () => useRemoteDatasourceContext('/test', []),
      { wrapper: createWrapper(router) },
    );

    expect(result.current.context).toEqual({});
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadingIds.size).toBe(0);
  });

  it('fetches each datasource individually via /p1/api/datasource-context', async () => {
    const router = createMockRouter();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('id=swapi')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'swapi', data: { name: 'Luke' } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    const registry = [
      {
        id: 'swapi',
        label: 'SWAPI',
        description: 'test',
        resolution: 'test',
        fields: [{ path: 'name', description: 'Name' }],
      },
    ];

    const { result } = renderHook(
      () => useRemoteDatasourceContext('/test', registry),
      { wrapper: createWrapper(router) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.context).toEqual({ swapi: { name: 'Luke' } });
    expect(result.current.loadingIds.size).toBe(0);

    expect(mockFetch).toHaveBeenCalledWith(
      '/p1/api/datasource-context?path=%2Ftest&id=swapi',
    );
  });

  it('reports loadingIds while datasources are pending', async () => {
    const router = createMockRouter();
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
    const mockFetch = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal('fetch', mockFetch);

    const registry = [
      {
        id: 'swapi',
        label: 'SWAPI',
        description: 'test',
        resolution: 'test',
        fields: [],
      },
    ];

    const { result } = renderHook(
      () => useRemoteDatasourceContext('/test', registry),
      { wrapper: createWrapper(router) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingIds.has('swapi')).toBe(true);

    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ id: 'swapi', data: { name: 'Luke' } }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadingIds.has('swapi')).toBe(false);
  });
});

describe('useP1Plugins', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array while loading', () => {
    const router = createMockRouter();
    const mockFetch = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', mockFetch);

    const mockConfig = { components: {}, root: { render: () => null } };
    const { result } = renderHook(
      () => useP1Plugins('/test', mockConfig as never),
      { wrapper: createWrapper(router) },
    );

    expect(result.current).toEqual([]);
  });

  it('returns three plugins after editor context loads', async () => {
    const router = createMockRouter();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/p1/api/editor-context')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(MOCK_EDITOR_CONTEXT),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    const mockConfig = { components: {}, root: { render: () => null } };
    const { result } = renderHook(
      () => useP1Plugins('/test', mockConfig as never),
      { wrapper: createWrapper(router) },
    );

    await waitFor(() => expect(result.current.length).toBe(3));

    const pluginNames = result.current.map((p) => p.name);
    expect(pluginNames).toContain('preview-resolve');
    expect(pluginNames).toContain('datasource-explorer');
    expect(pluginNames).toContain('field-connect');
  });
});
