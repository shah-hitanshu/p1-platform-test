/**
 * Creating a locale version from a feature
 *
 * The hook is how a feature reaches the editor's create-translation capability,
 * and it reports the absence of an editor rather than standing in for one.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { useCreateTranslation } from '../../features/localization/useCreateTranslation.js';

afterEach(cleanup);

function renderHook(context: Partial<P1PuckContextValue> | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const captured: { current: ReturnType<typeof useCreateTranslation> } = { current: null };

  function Host(): null {
    captured.current = useCreateTranslation();
    return null;
  }

  render(
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={context as P1PuckContextValue | null}>
        <Host />
      </P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>,
  );

  return captured;
}

describe('useCreateTranslation', () => {
  it('creates the version through the editor it is standing in', async () => {
    const createTranslation = vi.fn().mockResolvedValue({ id: 'doc-de', path: 'home.de-de' });
    const create = renderHook({ createTranslation } as Partial<P1PuckContextValue>);

    const created = await create.current?.({
      canonicalDocumentId: 'doc-home',
      locale: 'de-DE',
      mode: 'copy',
    });

    expect(createTranslation).toHaveBeenCalledWith({
      canonicalDocumentId: 'doc-home',
      locale: 'de-DE',
      mode: 'copy',
    });
    expect(created?.path).toBe('home.de-de');
  });

  it('offers nothing where there is no editor to create in', () => {
    // Null rather than a no-op: a caller that cannot create must be able to say
    // so, instead of reporting a version it never made.
    expect(renderHook(null).current).toBeNull();
  });
});
