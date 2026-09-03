import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  P1QueryProvider,
  P1SdkQueryProvider,
  useP1SdkQueryClient,
} from '../../data/query-provider';

function QueryClientCheck({ onClient }: { onClient: (client: unknown) => void }) {
  const client = useQueryClient();
  onClient(client);
  return <div>ok</div>;
}

describe('P1QueryProvider', () => {
  it('provides a QueryClient to children', () => {
    let captured: unknown = null;
    render(
      <P1QueryProvider>
        <QueryClientCheck onClient={(c) => { captured = c; }} />
      </P1QueryProvider>
    );
    expect(captured).not.toBeNull();
    expect(captured).toBeDefined();
  });
});

/**
 * SDK internals fetch through their own client so a host application's cache
 * neither governs nor holds their state.
 */
describe('P1SdkQueryProvider', () => {
  const PROBE_KEY = ['sdk-probe'];

  function renderProbe(queryFn: () => Promise<string>) {
    const clients: { host?: QueryClient; sdk?: QueryClient } = {};

    function Consumer() {
      clients.host = useQueryClient();
      clients.sdk = useP1SdkQueryClient();
      const { data } = useQuery({ queryKey: PROBE_KEY, queryFn }, clients.sdk);
      return <div>{data ?? 'pending'}</div>;
    }

    render(
      <P1QueryProvider>
        <P1SdkQueryProvider>
          <Consumer />
        </P1SdkQueryProvider>
      </P1QueryProvider>,
    );

    return clients as { host: QueryClient; sdk: QueryClient };
  }

  it('caches an SDK query in the SDK client and leaves the host cache empty', async () => {
    const clients = renderProbe(() => Promise.resolve('sdk-value'));

    await waitFor(() => expect(screen.getByText('sdk-value')).toBeInTheDocument());

    expect(clients.sdk.getQueryData(PROBE_KEY)).toBe('sdk-value');
    expect(clients.host.getQueryData(PROBE_KEY)).toBeUndefined();
    expect(clients.host.getQueryCache().getAll()).toHaveLength(0);
  });

  it('resolves the host client from context, so host components keep their own', async () => {
    const clients = renderProbe(() => Promise.resolve('sdk-value'));

    await waitFor(() => expect(screen.getByText('sdk-value')).toBeInTheDocument());

    expect(clients.host).not.toBe(clients.sdk);
    expect(clients.host.getQueryData(PROBE_KEY)).toBeUndefined();
    // A host write under the same key does not reach SDK state.
    clients.host.setQueryData(PROBE_KEY, 'host-value');
    expect(clients.sdk.getQueryData(PROBE_KEY)).toBe('sdk-value');
  });

  it('holds SDK data through a host-side clear of its own cache', async () => {
    const clients = renderProbe(() => Promise.resolve('sdk-value'));

    await waitFor(() => expect(screen.getByText('sdk-value')).toBeInTheDocument());

    clients.host.clear();
    void clients.host.invalidateQueries();

    expect(clients.sdk.getQueryData(PROBE_KEY)).toBe('sdk-value');
    expect(screen.getByText('sdk-value')).toBeInTheDocument();
  });

  it('carries the SDK query defaults rather than a host application\u2019s', async () => {
    const queryFn = vi.fn().mockResolvedValue('sdk-value');
    const clients = renderProbe(queryFn);

    await waitFor(() => expect(screen.getByText('sdk-value')).toBeInTheDocument());

    const defaults = clients.sdk.getDefaultOptions().queries;
    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('throws outside a provider rather than falling back to the host client', () => {
    function Consumer() {
      useP1SdkQueryClient();
      return null;
    }

    expect(() =>
      render(
        <P1QueryProvider>
          <Consumer />
        </P1QueryProvider>,
      ),
    ).toThrow(/P1SdkQueryProvider/);
  });
});
