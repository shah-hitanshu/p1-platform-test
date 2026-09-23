/**
 * Locale switcher
 *
 * The editor's one locale surface: which version of this page is open, which
 * markets already have a version, and which are still to be created.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LocaleSwitcher } from '../../features/localization/ui/LocaleSwitcher.js';
import type { LocaleRow } from '../../features/localization/locale-rows.js';

const rows: LocaleRow[] = [
  { locale: null, documentId: 'doc-canonical', state: 'exists', isSource: true },
  { locale: 'fr-FR', documentId: 'doc-fr', state: 'current', isSource: false },
  { locale: 'de-DE', documentId: null, state: 'available', isSource: false },
];

const markets = ['fr-FR', 'de-DE'];

const documents = [
  { id: 'doc-canonical', path: 'pricing' },
  { id: 'doc-fr', path: 'pricing.fr-FR' },
];

function SwitcherHarness({ overrides }: { overrides: Partial<React.ComponentProps<typeof LocaleSwitcher>> }) {
  const [open, setOpen] = React.useState(false);
  return (
    <LocaleSwitcher
      rows={rows}
      markets={markets}
      documents={documents}
      loading={false}
      failed={false}
      open={open}
      onOpenChange={setOpen}
      reviewStatus={new Map()}
      onRetry={vi.fn()}
      onOpenLocale={vi.fn()}
      onAddLocale={vi.fn()}
      {...overrides}
    />
  );
}

function renderSwitcher(overrides: Partial<React.ComponentProps<typeof LocaleSwitcher>> = {}) {
  return render(<SwitcherHarness overrides={overrides} />);
}

describe('LocaleSwitcher', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing where no page is open to measure the markets against', () => {
    const { container } = renderSwitcher({ rows: [] });

    expect(container.firstChild).toBeNull();
  });

  it('says the locales could not be read rather than reporting none', () => {
    renderSwitcher({ failed: true, rows: [], markets: [] });

    expect(screen.getByTestId('locale-switcher-retry').textContent).toContain(
      'Locales unavailable',
    );
    expect(screen.queryByTestId('locale-switcher-trigger')).toBeNull();
  });

  it('asks for the locales again when the failure is chosen', () => {
    const onRetry = vi.fn();
    renderSwitcher({ failed: true, rows: [], markets: [], onRetry });

    fireEvent.click(screen.getByTestId('locale-switcher-retry'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('names the locale currently open in its own language', () => {
    renderSwitcher();

    const trigger = screen.getByTestId('locale-switcher-trigger').textContent;
    expect(trigger).toContain('Français');
    expect(trigger).toContain('FR');
  });

  it('names the untagged page as Unset when it is the one open', () => {
    renderSwitcher({
      markets: ['fr-FR'],
      rows: [
        { locale: null, documentId: 'doc-canonical', state: 'current', isSource: true },
        { locale: 'fr-FR', documentId: null, state: 'available', isSource: false },
      ],
    });

    expect(screen.getByTestId('locale-switcher-trigger').textContent).toContain('Unset');
  });

  it('lists nothing until opened', () => {
    renderSwitcher();

    expect(screen.queryByTestId('locale-switcher-menu')).toBeNull();
  });

  it('lists every row once opened', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getAllByTestId(/^locale-row-/)).toHaveLength(3);
  });

  it('lists both pages where two share a locale', () => {
    renderSwitcher({
      rows: [
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'current', isSource: false },
        { locale: 'fr-FR', documentId: 'doc-fr-old', state: 'exists', isSource: false },
      ],
      documents: [
        { id: 'doc-fr', path: 'pricing.fr-FR' },
        { id: 'doc-fr-old', path: 'pricing-old.fr-FR' },
      ],
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getAllByTestId(/^locale-row-/)).toHaveLength(2);
  });

  it('names the page on each row where the locale cannot tell them apart', () => {
    renderSwitcher({
      rows: [
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'current', isSource: false },
        { locale: 'fr-FR', documentId: 'doc-fr-old', state: 'exists', isSource: false },
      ],
      documents: [
        { id: 'doc-fr', path: 'pricing.fr-FR' },
        { id: 'doc-fr-old', path: 'pricing-old.fr-FR' },
      ],
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-row-fr-FR-doc-fr').textContent).toContain('pricing.fr-FR');
    expect(screen.getByTestId('locale-row-fr-FR-doc-fr-old').textContent).toContain(
      'pricing-old.fr-FR',
    );
  });

  it('opens the page a shared-locale row names rather than the first of them', () => {
    const onOpenLocale = vi.fn();
    renderSwitcher({
      rows: [
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'current', isSource: false },
        { locale: 'fr-FR', documentId: 'doc-fr-old', state: 'exists', isSource: false },
      ],
      documents: [
        { id: 'doc-fr', path: 'pricing.fr-FR' },
        { id: 'doc-fr-old', path: 'pricing-old.fr-FR' },
      ],
      onOpenLocale,
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    fireEvent.click(screen.getByTestId('locale-row-fr-FR-doc-fr-old'));

    expect(onOpenLocale).toHaveBeenCalledWith('doc-fr-old');
  });

  it('names the language, not the path, where a locale holds one page', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-row-fr-FR').textContent).toContain('French');
    expect(screen.getByTestId('locale-row-fr-FR').textContent).not.toContain('pricing');
  });

  it('opens a locale that already has a version', () => {
    const onOpenLocale = vi.fn();
    renderSwitcher({ onOpenLocale });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    fireEvent.click(screen.getByTestId('locale-row-none'));

    expect(onOpenLocale).toHaveBeenCalledWith('doc-canonical');
  });

  it('offers to add a market with no version yet', () => {
    const onAddLocale = vi.fn();
    renderSwitcher({ onAddLocale });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    fireEvent.click(screen.getByTestId('locale-row-de-DE'));

    expect(onAddLocale).toHaveBeenCalledWith('de-DE');
  });

  it('does not reopen the locale already being edited', () => {
    const onOpenLocale = vi.fn();
    renderSwitcher({ onOpenLocale });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    fireEvent.click(screen.getByTestId('locale-row-fr-FR'));

    expect(onOpenLocale).not.toHaveBeenCalled();
  });

  it('marks the open locale for assistive technology', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-row-fr-FR').getAttribute('aria-current')).toBe('true');
  });

  it('closes once a locale is chosen', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    fireEvent.click(screen.getByTestId('locale-row-none'));

    expect(screen.queryByTestId('locale-switcher-menu')).toBeNull();
  });

  it('names each market in its own language, with its English name beneath', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    const row = screen.getByTestId('locale-row-fr-FR');
    expect(row.textContent).toContain('Français');
    expect(row.textContent).toContain('French (France)');
  });

  it('badges each market with its region', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-badge-de-DE').textContent).toBe('DE');
  });

  it('states that a market has no version of this page yet', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-row-de-DE').textContent).toContain('Not localized yet');
  });

  it('names the market in the invitation to add it', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-add-de-DE').textContent).toContain('Add DE');
  });

  it('shows progress while the review status is loading', () => {
    renderSwitcher({ reviewStatus: new Map([['doc-fr', 'checking']]) });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    const status = screen.getByTestId('locale-status-fr-FR');
    expect(status).toHaveAttribute('aria-label', 'Checking translation status');
    expect(status.querySelector('.pds-spinner')).not.toBeNull();
  });

  it('names the source row by its unset locale, not as a market', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-row-none').textContent).toContain('Source locale unset');
    expect(screen.queryByTestId('locale-status-none')).toBeNull();
  });

  it('flags a market that reads right to left', () => {
    renderSwitcher({
      markets: ['ar-AE', 'fr-FR'],
      rows: [
        { locale: 'ar-AE', documentId: null, state: 'available', isSource: false },
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'current', isSource: false },
      ],
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-rtl-ar-AE')).toBeDefined();
    expect(screen.queryByTestId('locale-rtl-fr-FR')).toBeNull();
  });

  it('closes when the click lands outside it', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    fireEvent.pointerDown(document.body);

    expect(screen.queryByTestId('locale-switcher-menu')).toBeNull();
  });

  it('renders nothing while the site is still reporting its markets', () => {
    const { container } = renderSwitcher({ loading: true, rows: [], markets: [] });

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a site that publishes in no locales', () => {
    const { container } = renderSwitcher({
      markets: [],
      rows: [{ locale: null, documentId: 'doc-canonical', state: 'current', isSource: true }],
    });

    expect(container.firstChild).toBeNull();
  });

  it('groups the source row apart from the other locales', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    const menu = screen.getByTestId('locale-switcher-menu');
    expect(menu.textContent).toContain('Source');
    expect(menu.textContent).toContain('Other locales');
    // The canonical's own row lists under Source, not Other locales.
    expect(screen.queryByTestId('locale-status-none')).toBeNull();
  });

  it('checks off the market currently open', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-current-fr-FR')).toBeDefined();
    expect(screen.queryByTestId('locale-current-de-DE')).toBeNull();
  });

  it("flags a variant with the source's changes still pending as needing review", () => {
    renderSwitcher({ reviewStatus: new Map([['doc-fr', 'needsReview']]) });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    expect(screen.getByTestId('locale-status-fr-FR')).toHaveTextContent('Needs review');
  });

  it('visibly marks the source when it is the current page', () => {
    renderSwitcher({ rows: rows.map((row) => ({ ...row, state: row.isSource ? 'current' : row.documentId ? 'exists' : 'available' })) });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    expect(screen.getByTestId('locale-current-none')).toBeInTheDocument();
  });

  it('disambiguates only among other-locale rows', () => {
    renderSwitcher({ rows: [
      { locale: 'fr-FR', documentId: 'doc-canonical', state: 'exists', isSource: true },
      { locale: 'fr-FR', documentId: 'doc-fr', state: 'current', isSource: false },
    ] });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    const translation = screen.getAllByRole('menuitem').find((row) => row.getAttribute('aria-current') === 'true');
    expect(translation).toHaveTextContent('French');
    expect(translation).not.toHaveTextContent('pricing');
  });

  it('reports a failed review check without a success badge', () => {
    renderSwitcher({ reviewStatus: new Map([['doc-fr', 'unavailable']]) });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    expect(screen.getByTestId('locale-status-fr-FR')).toHaveTextContent('Status unavailable');
  });

  it('states on the trigger that the source has moved on, in place of the review status', () => {
    renderSwitcher({
      reviewStatus: new Map([['doc-fr', 'needsReview']]),
      drift: { outstanding: 3, structuralOnly: false, onReview: vi.fn() },
    });

    expect(screen.getByTestId('locale-switcher-drift')).toHaveTextContent('Source changed');
    expect(screen.queryByTestId('locale-switcher-status')).toBeNull();
  });

  it('keeps the review status on the trigger while the source has not moved on', () => {
    renderSwitcher({
      reviewStatus: new Map([['doc-fr', 'translated']]),
      drift: { outstanding: 0, structuralOnly: false, onReview: vi.fn() },
    });

    expect(screen.getByTestId('locale-switcher-status')).toHaveTextContent('Up to date');
    expect(screen.queryByTestId('locale-switcher-drift')).toBeNull();
  });

  it('says the structure changed where the source only moved blocks', () => {
    renderSwitcher({ drift: { outstanding: 0, structuralOnly: true, onReview: vi.fn() } });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-switcher-drift')).toHaveTextContent('Structure changed');
    expect(screen.getByTestId('locale-review-changes')).toHaveTextContent('Structure changed');
    // Said once on the row, under it, rather than twice.
    expect(screen.queryByTestId('locale-drift-fr-FR')).toBeNull();
  });

  it('counts the changes under the locale open and opens the list', () => {
    const onReview = vi.fn();
    renderSwitcher({
      reviewStatus: new Map([['doc-fr', 'needsReview']]),
      drift: { outstanding: 3, structuralOnly: false, onReview },
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-drift-fr-FR')).toHaveTextContent('Source changed');
    expect(screen.queryByTestId('locale-status-fr-FR')).toBeNull();
    expect(screen.getByTestId('locale-review-changes')).toHaveTextContent(
      '3 changes since translation',
    );

    fireEvent.click(screen.getByTestId('locale-review-changes'));

    expect(onReview).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('locale-switcher-menu')).toBeNull();
  });

  it('counts a single change in the singular', () => {
    renderSwitcher({ drift: { outstanding: 1, structuralOnly: false, onReview: vi.fn() } });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-review-changes')).toHaveTextContent(
      '1 change since translation',
    );
  });

  it('opens the list from anywhere on the row of the locale already open', () => {
    const onReview = vi.fn();
    const onOpenLocale = vi.fn();
    renderSwitcher({
      onOpenLocale,
      drift: { outstanding: 3, structuralOnly: false, onReview },
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    fireEvent.click(screen.getByTestId('locale-row-fr-FR'));

    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onOpenLocale).not.toHaveBeenCalled();
  });

  it('offers no list from a locale whose source has not moved on', () => {
    renderSwitcher({ reviewStatus: new Map([['doc-fr', 'translated']]) });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.queryByTestId('locale-review-changes')).toBeNull();
    expect(screen.queryByTestId('locale-drift-fr-FR')).toBeNull();
  });
  it('carries no review status on a row whose only report is structural', () => {
    renderSwitcher({
      reviewStatus: new Map([['doc-fr', 'translated']]),
      drift: { outstanding: 0, structuralOnly: true, onReview: vi.fn() },
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.queryByTestId('locale-status-fr-FR')).toBeNull();
  });

  it('counts one menu item per locale, whatever the row carries under it', () => {
    renderSwitcher({ drift: { outstanding: 3, structuralOnly: false, onReview: vi.fn() } });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getAllByRole('menuitem')).toHaveLength(rows.length);
  });

  it('keeps the way to the changes where the site configures no markets', () => {
    const onReview = vi.fn();
    renderSwitcher({
      markets: [],
      drift: { outstanding: 3, structuralOnly: false, onReview },
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));
    fireEvent.click(screen.getByTestId('locale-review-changes'));

    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('keeps the way to the changes where the locales could not be read', () => {
    const onReview = vi.fn();
    renderSwitcher({
      failed: true,
      rows: [],
      markets: [],
      drift: { outstanding: 3, structuralOnly: false, onReview },
    });

    expect(screen.getByTestId('locale-switcher-retry')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('locale-switcher-drift-alone'));

    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('states the structure changed in the neutral tone where there is no list to draw', () => {
    renderSwitcher({
      rows: [],
      drift: { outstanding: 0, structuralOnly: true, onReview: vi.fn() },
    });

    expect(screen.getByTestId('locale-switcher-drift-alone')).toHaveTextContent(
      'Structure changed',
    );
  });
  it('leaves focus on the trigger when the list of changes is opened', () => {
    renderSwitcher({ drift: { outstanding: 3, structuralOnly: false, onReview: vi.fn() } });
    const trigger = screen.getByTestId('locale-switcher-trigger');
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId('locale-review-changes'));

    expect(document.activeElement).toBe(trigger);
  });
});
