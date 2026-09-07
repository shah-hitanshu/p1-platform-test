/**
 * Locale rows for the open document
 *
 * Joins the site's markets to the variants a canonical holds. The open document
 * may be either the canonical or one of its translations, and the rows are the
 * same either way — a translation resolves up to its canonical first.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { useLocaleRows } from '../../features/localization/useLocaleRows.js';

const canonicalDoc = {
  id: 'doc-canonical',
  siteId: 'site-1',
  path: 'pricing',
  localizedFromId: null,
};

const frenchDoc = {
  id: 'doc-fr',
  siteId: 'site-1',
  path: 'pricing.fr-FR',
  locale: 'fr-FR',
  localizedFromId: 'doc-canonical',
};

const getSettings = vi.fn();
const listVariants = vi.fn();

function makeClient() {
  return {
    sites: { getSettings },
    translations: { listVariants },
  };
}

function makeCtx(currentDocument: unknown): P1PuckContextValue {
  return {
    client: makeClient(),
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument,
  } as unknown as P1PuckContextValue;
}

function Probe(): React.ReactElement {
  const { rows, loading, failed } = useLocaleRows();
  return (
    <div
      data-testid="probe"
      data-loading={String(loading)}
      data-failed={String(failed)}
      data-rows={rows.map((r) => `${r.locale ?? 'none'}:${r.state}`).join(',')}
    />
  );
}

function renderProbe(currentDocument: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={makeCtx(currentDocument)}>
        <Probe />
      </P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>,
  );
}

const rowsOf = (): string => screen.getByTestId('probe').getAttribute('data-rows') ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({
    settings: { locales: { markets: ['fr-FR', 'de-DE'], policy: 'fallback' } },
  });
  listVariants.mockResolvedValue({
    canonical: canonicalDoc,
    variants: [{ document: frenchDoc, localization: {} }],
  });
});

afterEach(() => {
  cleanup();
});

describe('useLocaleRows', () => {
  it('lists the site markets against the canonical variants', async () => {
    renderProbe(canonicalDoc);

    await waitFor(() => {
      expect(rowsOf()).toBe('none:current,fr-FR:exists,de-DE:available');
    });
  });

  it('resolves a translation up to its canonical before listing', async () => {
    renderProbe(frenchDoc);

    await waitFor(() => {
      expect(listVariants).toHaveBeenCalledWith('site-1', 'branch-1', 'doc-canonical');
    });
  });

  it('marks the open translation as current, not its canonical', async () => {
    renderProbe(frenchDoc);

    await waitFor(() => {
      expect(rowsOf()).toBe('none:exists,fr-FR:current,de-DE:available');
    });
  });

  it('asks for the variants of the open document when it is a canonical', async () => {
    renderProbe(canonicalDoc);

    await waitFor(() => {
      expect(listVariants).toHaveBeenCalledWith('site-1', 'branch-1', 'doc-canonical');
    });
  });

  it('reports loading until both the markets and the variants arrive', async () => {
    renderProbe(canonicalDoc);

    expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('true');
    await waitFor(() => {
      expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false');
    });
  });

  it('lists no markets for a site that configures none', async () => {
    getSettings.mockResolvedValue({ settings: {} });
    listVariants.mockResolvedValue({ canonical: canonicalDoc, variants: [] });
    renderProbe(canonicalDoc);

    await waitFor(() => {
      expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false');
    });
    expect(rowsOf()).toBe('none:current');
  });

  it('settles rather than loading on where the site markets cannot be read', async () => {
    getSettings.mockRejectedValue(new Error('settings unavailable'));
    renderProbe(canonicalDoc);

    await waitFor(() => {
      expect(screen.getByTestId('probe').getAttribute('data-failed')).toBe('true');
    });
    expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false');
  });

  it('settles rather than loading on where the page versions cannot be read', async () => {
    listVariants.mockRejectedValue(new Error('variants unavailable'));
    renderProbe(canonicalDoc);

    await waitFor(() => {
      expect(screen.getByTestId('probe').getAttribute('data-failed')).toBe('true');
    });
    expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false');
  });

  it('reports no failure once both answer', async () => {
    renderProbe(canonicalDoc);

    await waitFor(() => {
      expect(screen.getByTestId('probe').getAttribute('data-loading')).toBe('false');
    });
    expect(screen.getByTestId('probe').getAttribute('data-failed')).toBe('false');
  });

  it('fetches nothing when no document is open', () => {
    renderProbe(null);

    expect(listVariants).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
  });
});
