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
  { locale: null, documentId: 'doc-canonical', state: 'exists' },
  { locale: 'fr-FR', documentId: 'doc-fr', state: 'current' },
  { locale: 'de-DE', documentId: null, state: 'available' },
];

const markets = ['fr-FR', 'de-DE'];

const documents = [
  { id: 'doc-canonical', path: 'pricing' },
  { id: 'doc-fr', path: 'pricing.fr-FR' },
];

function renderSwitcher(overrides: Partial<React.ComponentProps<typeof LocaleSwitcher>> = {}) {
  return render(
    <LocaleSwitcher
      rows={rows}
      markets={markets}
      documents={documents}
      loading={false}
      failed={false}
      onRetry={vi.fn()}
      onOpenLocale={vi.fn()}
      onAddLocale={vi.fn()}
      {...overrides}
    />,
  );
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
        { locale: null, documentId: 'doc-canonical', state: 'current' },
        { locale: 'fr-FR', documentId: null, state: 'available' },
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
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'current' },
        { locale: 'fr-FR', documentId: 'doc-fr-old', state: 'exists' },
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
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'current' },
        { locale: 'fr-FR', documentId: 'doc-fr-old', state: 'exists' },
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
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'current' },
        { locale: 'fr-FR', documentId: 'doc-fr-old', state: 'exists' },
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

  it('counts the markets the site publishes in', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-switcher-count').textContent).toBe('2 site locales');
  });

  it('counts a single market in the singular', () => {
    renderSwitcher({
      markets: ['fr-FR'],
      rows: [
        { locale: null, documentId: 'doc-canonical', state: 'current' },
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'exists' },
      ],
    });
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-switcher-count').textContent).toBe('1 site locale');
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

  it('reports a market that already holds a version as localized', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-status-fr-FR').textContent).toBe('Localized');
  });

  it('reports the untagged page as Unset rather than as a locale', () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId('locale-switcher-trigger'));

    expect(screen.getByTestId('locale-row-none').textContent).toContain('Unset');
    expect(screen.queryByTestId('locale-status-none')).toBeNull();
  });

  it('flags a market that reads right to left', () => {
    renderSwitcher({
      markets: ['ar-AE', 'fr-FR'],
      rows: [
        { locale: 'ar-AE', documentId: null, state: 'available' },
        { locale: 'fr-FR', documentId: 'doc-fr', state: 'current' },
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
      rows: [{ locale: null, documentId: 'doc-canonical', state: 'current' }],
    });

    expect(container.firstChild).toBeNull();
  });
});
