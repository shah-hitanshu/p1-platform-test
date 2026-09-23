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
vi.mock('@puckeditor/core', () => ({
  usePuck: () => ({ dispatch: vi.fn(), refreshPermissions: vi.fn() }),
  createUsePuck: () => (selector: (state: unknown) => unknown) =>
    selector({
      dispatch: vi.fn(),
      selectedItem: null,
      config: {},
      appState: { data: { root: { props: { title: 'Tarifs' } } } },
      getSelectorForId: () => ({ zone: 'root:default-zone', index: 0 }),
      getItemById: () => ({ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Tarifs' } }),
    }),
  useGetPuck: () => () => ({
    dispatch: vi.fn(),
    appState: { data: { content: [], root: { props: { title: 'Tarifs' } } } },
    getSelectorForId: () => ({ zone: 'root:default-zone', index: 0 }),
    getItemById: () => ({ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Tarifs' } }),
  }),
}));

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

/** What the source has changed since this page was translated from it. */
function sourceDiff(changes: unknown[]) {
  return {
    relationType: 'localization',
    derivedDocumentId: 'doc-fr',
    upstreamDocumentId: 'doc-canonical',
    fromVersion: 4,
    toVersion: 7,
    fromVersionId: 'v4',
    toVersionId: 'v7',
    slotDelta: {},
    changes,
    counts: {
      structural: 0,
      prop: 0,
      advisory: 0,
      autoApplied: 0,
      needsTranslation: changes.length,
    },
  };
}

const getSettings = vi.fn();
const listVariants = vi.fn();
const getUpstreamDiff = vi.fn();
const openDocument = vi.fn();
const openCreatePage = vi.fn();

function renderControl(currentDocument: unknown, knownMarkets?: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (knownMarkets) queryClient.setQueryData([SITE_MARKETS_KEY, 'site-1'], knownMarkets);
  const ctx = {
    client: {
      sites: { getSettings },
      translations: { listVariants },
      relations: { getUpstreamDiff, setUpstreamResolutions: vi.fn() },
    },
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument,
    documents: [canonicalDoc, frenchDoc],
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
  getUpstreamDiff.mockReset();
  getUpstreamDiff.mockResolvedValue(sourceDiff([]));
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

  it('states on the switcher that the source has changed since this page was translated', async () => {
    getUpstreamDiff.mockResolvedValue(sourceDiff([
      {
        classification: 'needsTranslation',
        componentId: 'root',
        propPath: '/title',
        upstreamOldValue: 'Pricing',
        upstreamNewValue: 'Our pricing',
        documentValue: 'Tarifs',
      },
    ]));
    renderControl(frenchDoc);

    await waitFor(() => expect(screen.getByTestId('locale-switcher-drift')).toHaveTextContent(
      'Source changed',
    ));

    await openMenu();
    expect(screen.getByTestId('locale-review-changes')).toHaveTextContent(
      '1 change since translation',
    );
  });

  it('opens the list of source changes from the locale open in the menu', async () => {
    getUpstreamDiff.mockResolvedValue(sourceDiff([
      {
        classification: 'needsTranslation',
        componentId: 'root',
        propPath: '/title',
        upstreamOldValue: 'Pricing',
        upstreamNewValue: 'Our pricing',
        documentValue: 'Tarifs',
      },
    ]));
    renderControl(frenchDoc);
    await waitFor(() => screen.getByTestId('locale-switcher-drift'));
    await openMenu();

    fireEvent.click(screen.getByTestId('locale-review-changes'));

    expect(await screen.findByTestId('upstream-changes-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('upstream-changes-behind')).toHaveTextContent('1 change since v4');
  });

  it('carries no drift signal on a canonical page', async () => {
    renderControl(canonicalDoc, ['fr-FR', 'de-DE']);

    await waitFor(() => screen.getByTestId('locale-switcher-trigger'));
    expect(screen.queryByTestId('locale-switcher-drift')).toBeNull();
    expect(getUpstreamDiff).not.toHaveBeenCalledWith('site-1', 'branch-1', 'doc-canonical', 'localization');
  });
});
