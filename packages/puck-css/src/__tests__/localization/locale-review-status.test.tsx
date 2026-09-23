import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { NotFoundError, type ChangeSummary, type P1Client } from '@pantheon-systems/css-client';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { useLocaleReviewStatus } from '../../features/localization/useLocaleReviewStatus.js';
import { upstreamDiffQueryKey } from '../../features/localization/upstream-diff-query.js';
import type { LocaleRow } from '../../features/localization/locale-rows.js';

const rows: LocaleRow[] = [
  { locale: 'en-US', documentId: 'source', isSource: true, state: 'current' },
  { locale: 'fr-FR', documentId: 'fr', isSource: false, state: 'exists' },
  { locale: 'de-DE', documentId: 'de', isSource: false, state: 'exists' },
  { locale: 'ar-AE', documentId: null, isSource: false, state: 'available' },
];
const summary = (classification?: string) => ({ changes: classification ? [{ classification }] : [] });

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const getUpstreamDiff = vi.fn(async (_site: string, _branch: string, document: string) => summary(document === 'fr' ? 'structural' : undefined));
  const client = { relations: { getUpstreamDiff } } as unknown as P1Client;
  const wrapper = ({ children }: { children: React.ReactNode }) => <P1SdkQueryClientContext.Provider value={queryClient}>{children}</P1SdkQueryClientContext.Provider>;
  const hook = renderHook(({ open }) => useLocaleReviewStatus(client, 'site', 'branch', rows, open, null), { wrapper, initialProps: { open: false } });
  return { ...hook, queryClient, getUpstreamDiff };
}

describe('Locale review status', () => {
  it('checks existing translations only while open, reusing fresh results when reopened', async () => {
    const { result, rerender, getUpstreamDiff } = setup();
    expect(getUpstreamDiff).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => expect(result.current.get('fr')).toBe('translated'));
    expect(result.current.get('de')).toBe('translated');
    expect(getUpstreamDiff).toHaveBeenCalledTimes(2);
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.get('fr')).toBe('translated');
    expect(getUpstreamDiff).toHaveBeenCalledTimes(2);
  });

  it('uses a fresh summary already fetched by the drawer', async () => {
    const { result, rerender, queryClient, getUpstreamDiff } = setup();
    queryClient.setQueryData(upstreamDiffQueryKey('site', 'branch', 'fr', 'localization'), summary());
    rerender({ open: true });
    await waitFor(() => expect(result.current.get('fr')).toBe('translated'));
    expect(getUpstreamDiff).not.toHaveBeenCalledWith('site', 'branch', 'fr', 'localization');
  });

  it('reports loading and failed checks explicitly', async () => {
    const { result, rerender, getUpstreamDiff } = setup();
    let reject!: (error: Error) => void;
    getUpstreamDiff.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    rerender({ open: true });
    expect(result.current.get('de')).toBe('checking');
    await act(async () => reject(new Error('offline')));
    await waitFor(() => expect(result.current.get('de')).toBe('unavailable'));
  });

  it('does not show a cached success when the source relation disappears', async () => {
    const { result, rerender, getUpstreamDiff, queryClient } = setup();
    rerender({ open: true });
    await waitFor(() => expect(result.current.get('de')).toBe('translated'));
    getUpstreamDiff.mockRejectedValue(new NotFoundError('Source missing'));
    await act(() => queryClient.invalidateQueries());
    await waitFor(() => expect(result.current.get('de')).toBe('noSource'));
  });

  it('derives status from outstanding changes rather than a stale tally', async () => {
    const { result, rerender, queryClient } = setup();
    queryClient.setQueryData<ChangeSummary>(upstreamDiffQueryKey('site', 'branch', 'fr', 'localization'), {
      ...summary(), counts: { needsTranslation: 1 },
    } as ChangeSummary);
    rerender({ open: true });
    await waitFor(() => expect(result.current.get('fr')).toBe('translated'));
  });
});
