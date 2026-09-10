/**
 * Locale field
 *
 * A market picker bounded to the site's registry. No locale is the field's empty
 * state rather than an option, and a market is reachable by any of the names a
 * person might type for it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LocaleField } from './LocaleField.js';

const locales = [
  { tag: 'de-DE', native: 'Deutsch', english: 'German' },
  { tag: 'fr-FR', native: 'Français', english: 'French' },
];

afterEach(() => {
  cleanup();
});

describe('LocaleField', () => {
  it('reads Unset until a market is chosen', () => {
    render(<LocaleField id="locale" label="Locale" locales={locales} onChange={() => {}} />);

    expect(screen.getByTestId('locale').getAttribute('data-placeholder')).toBe('Unset');
  });

  it('offers every market the site has configured', () => {
    render(<LocaleField id="locale" label="Locale" locales={locales} onChange={() => {}} />);

    expect(screen.getByTestId('locale-option-de-DE')).toBeTruthy();
    expect(screen.getByTestId('locale-option-fr-FR')).toBeTruthy();
  });

  it('names a market in its own language, alongside its English name and tag', () => {
    render(<LocaleField id="locale" label="Locale" locales={locales} onChange={() => {}} />);

    const option = screen.getByTestId('locale-option-de-DE').textContent;
    expect(option).toContain('Deutsch');
    expect(option).toContain('German');
    expect(option).toContain('de-DE');
  });

  it('finds a market by native name, English name, or tag', () => {
    render(<LocaleField id="locale" label="Locale" locales={locales} onChange={() => {}} />);

    const searchable = screen.getByTestId('locale-option-fr-FR').getAttribute('data-search');
    expect(searchable).toContain('Français');
    expect(searchable).toContain('French');
    expect(searchable).toContain('fr-FR');
  });

  it('reports the market chosen', () => {
    const onChange = vi.fn();
    render(<LocaleField id="locale" label="Locale" locales={locales} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('locale-option-fr-FR'));

    expect(onChange).toHaveBeenCalledWith('fr-FR');
  });

  it('reports back to no locale when cleared', () => {
    const onChange = vi.fn();
    render(<LocaleField id="locale" label="Locale" locales={locales} onChange={onChange} />);

    fireEvent.click(screen.getByTitle('Clear input text'));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders nothing for a site with no markets', () => {
    const { container } = render(
      <LocaleField id="locale" label="Locale" locales={[]} onChange={() => {}} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
