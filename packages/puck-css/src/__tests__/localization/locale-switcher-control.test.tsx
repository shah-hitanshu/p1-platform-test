/**
 * Locale switcher in the editor
 *
 * Joins the switcher to the open document: choosing a market that has a version
 * asks for that version to be opened, and choosing one that does not asks for a
 * version to be created.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { LocaleSwitcherControl } from '../../features/localization/ui/LocaleSwitcherControl.js';
import { SITE_MARKETS_KEY } from '../../features/localization/useSiteMarkets.js';

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
const openDocument = vi.fn();
const openCreatePage = vi.fn();

function renderControl(currentDocument: unknown, knownMarkets?: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (knownMarkets) queryClient.setQueryData([SITE_MARKETS_KEY, 'site-1'], knownMarkets);
  const ctx = {
    client: { sites: { getSettings }, translations: { listVariants } },
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument,
  } as unknown as P1PuckContextValue;

  return render(
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={ctx}>
        <LocaleSwitcherControl openDocument={openDocument} openCreatePage={openCreatePage} />
      </P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>,
  );
}

async function openMenu(): Promise<void> {
  await waitFor(() => screen.getByTestId('locale-switcher-trigger'));
  fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
}

beforeEach(() => {
  getSettings.mockReset();
  listVariants.mockReset();
  openDocument.mockReset();
  openCreatePage.mockReset();
  getSettings.mockResolvedValue({
    settings: { locales: { markets: ['fr-FR', 'de-DE'], policy: 'fallback' } },
  });
  listVariants.mockResolvedValue({
    canonical: canonicalDoc,
    variants: [{ document: frenchDoc }],
  });
});

afterEach(cleanup);

describe('LocaleSwitcherControl', () => {
  it('asks for the page held by the market chosen', async () => {
    renderControl(canonicalDoc);
    await openMenu();

    fireEvent.click(screen.getByTestId('locale-row-fr-FR'));

    expect(openDocument).toHaveBeenCalledWith('pricing.fr-FR');
  });

  it('asks for the canonical from one of its translations', async () => {
    renderControl(frenchDoc);
    await openMenu();

    fireEvent.click(screen.getByTestId('locale-row-none'));

    expect(openDocument).toHaveBeenCalledWith('pricing');
  });

  it('asks for a page in a market that holds no version of this one', async () => {
    renderControl(canonicalDoc);
    await openMenu();

    fireEvent.click(screen.getByTestId('locale-row-de-DE'));

    expect(openCreatePage).toHaveBeenCalledWith({
      locale: 'de-DE',
      sourceDocumentId: 'doc-canonical',
    });
  });

  it('starts a new version from the canonical even while a translation is open', async () => {
    renderControl(frenchDoc);
    await openMenu();

    fireEvent.click(screen.getByTestId('locale-row-de-DE'));

    expect(openCreatePage).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDocumentId: 'doc-canonical' }),
    );
  });

  it('renders nothing until the site reports its markets', () => {
    const { container } = renderControl(canonicalDoc);

    expect(container.firstChild).toBeNull();
  });

  it('says the locales could not be read rather than hiding the switcher', async () => {
    getSettings.mockRejectedValue(new Error('settings unavailable'));
    renderControl(canonicalDoc);

    await waitFor(() => screen.getByTestId('locale-switcher-retry'));
    expect(screen.queryByTestId('locale-switcher-trigger')).toBeNull();
  });

  it('lists the locales once asking again succeeds', async () => {
    getSettings.mockRejectedValueOnce(new Error('settings unavailable'));
    renderControl(canonicalDoc);

    await waitFor(() => screen.getByTestId('locale-switcher-retry'));
    fireEvent.click(screen.getByTestId('locale-switcher-retry'));

    await waitFor(() => screen.getByTestId('locale-switcher-trigger'));
    expect(screen.queryByTestId('locale-switcher-retry')).toBeNull();
  });

  it('renders nothing with no page open, even where the site markets are known', () => {
    const { container } = renderControl(null, ['fr-FR', 'de-DE']);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing with no document open', async () => {
    const { container } = renderControl(null);

    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(getSettings).not.toHaveBeenCalled();
  });
});
