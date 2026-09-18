import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ChangeSummary, ChangeSummaryEntry, P1Client } from '@pantheon-systems/css-client';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import type { P1PuckContextValue } from '../../core/types.js';
import { useUpstreamResolution } from '../../features/localization/useUpstreamResolution.js';
import { upstreamDiffQueryKey } from '../../features/localization/upstream-diff-query.js';

const first: ChangeSummaryEntry = {
  classification: 'needsTranslation',
  componentId: 'heading',
  propPath: '/title',
  upstreamNewValue: 'Hello',
};

const second: ChangeSummaryEntry = { ...first, propPath: '/subtitle', upstreamNewValue: 'World' };

function setup() {
  const summary: ChangeSummary = {
    relationType: 'localization',
    derivedDocumentId: 'translation',
    upstreamDocumentId: 'source',
    fromVersion: 2,
    toVersion: 7,
    fromVersionId: 'v2',
    toVersionId: 'v7',
    slotDelta: {},
    changes: [first, second],
    counts: { structural: 0, prop: 0, advisory: 0, autoApplied: 0, needsTranslation: 2 },
  };

  const queryClient = new QueryClient();
  const key = upstreamDiffQueryKey('site', 'branch', 'translation', 'localization');
  queryClient.setQueryData(key, summary);

  const writes: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const setUpstreamResolutions = vi.fn(() => new Promise((resolve, reject) => {
    writes.push({ resolve: () => resolve({ upstreamResolutions: {} }), reject });
  }));
  const addError = vi.fn();
  const client = { relations: { setUpstreamResolutions } } as unknown as P1Client;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={{ notifications: { addError } } as unknown as P1PuckContextValue}>
        {children}
      </P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>
  );

  const hook = renderHook(() => useUpstreamResolution(client, 'site', 'branch', 'translation', 'localization'), { wrapper });
  const cached = () => queryClient.getQueryData<ChangeSummary>(key)!;

  return { ...hook, summary, cached, queryClient, key, writes, addError, setUpstreamResolutions };
}

describe('Upstream resolutions', () => {
  it('removes the exact change and updates the shared tally while the write is pending', async () => {
    const { result, summary, cached, setUpstreamResolutions, writes } = setup();

    act(() => result.current.resolve(first, summary));
    await waitFor(() => expect(cached().changes).toEqual([second]));

    expect(cached().counts.needsTranslation).toBe(1);
    expect(setUpstreamResolutions).toHaveBeenCalledWith('site', 'branch', 'translation', [{ slotId: 'heading', propPath: '/title' }], 'v7');
    await act(async () => writes[0]!.resolve());
  });

  it('restores a failed resolution without resurrecting a successful sibling', async () => {
    const { result, summary, cached, writes, addError } = setup();

    act(() => {
      result.current.resolve(first, summary);
      result.current.resolve(second, summary);
    });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(cached().changes).toEqual([]);

    await act(async () => writes[1]!.resolve());
    await act(async () => writes[0]!.reject(new Error('offline')));
    await waitFor(() => expect(cached().changes).toEqual([first]));
    expect(cached().counts.needsTranslation).toBe(1);
    expect(addError).toHaveBeenCalledWith(expect.stringContaining('still listed'));
  });

  it('does not insert an old failed change into a newer source comparison', async () => {
    const { result, summary, cached, writes, queryClient, key } = setup();

    act(() => result.current.resolve(first, summary));
    await waitFor(() => expect(writes).toHaveLength(1));

    queryClient.setQueryData(key, { ...summary, toVersionId: 'v8', changes: [second] });
    await act(async () => writes[0]!.reject(new Error('offline')));
    expect(cached().changes).toEqual([second]);
  });

  it('submits a pending target only once', async () => {
    const { result, summary, writes, setUpstreamResolutions } = setup();

    act(() => {
      result.current.resolve(first, summary);
      result.current.resolve(first, summary);
    });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(setUpstreamResolutions).toHaveBeenCalledTimes(1);
    await act(async () => writes[0]!.resolve());
  });
});
