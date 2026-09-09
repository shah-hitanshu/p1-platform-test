// @vitest-environment node
/**
 * Locale labels
 *
 * Turns a market's BCP-47 tag into the three things the editor shows for it:
 * the language's own name, its name in English, and a short badge.
 */

import { describe, it, expect } from 'vitest';
import { localeLabel } from '../../features/localization/locale-labels.js';

describe('localeLabel', () => {
  it('names a market in its own language', () => {
    expect(localeLabel('fr-FR').native).toBe('Français (France)');
  });

  it('capitalises a language whose own name is written lower case', () => {
    expect(localeLabel('de-DE').native).toBe('Deutsch (Deutschland)');
    expect(localeLabel('ja-JP').native).toBe('日本語 (日本)');
  });

  it('names a language-only market without a region to add', () => {
    expect(localeLabel('ja').native).toBe('日本語');
  });

  it('names two markets of one language apart, region and script alike', () => {
    expect(localeLabel('pt-BR').native).not.toBe(localeLabel('pt-PT').native);
    expect(localeLabel('zh-Hans').native).not.toBe(localeLabel('zh-Hant').native);
  });

  it('names a market in English, region and all, so two English markets read apart', () => {
    expect(localeLabel('en-GB').english).not.toBe(localeLabel('en-US').english);
  });

  it('badges the market with its region', () => {
    expect(localeLabel('pt-BR').tag).toBe('BR');
  });

  it('badges a language-only tag with the language', () => {
    expect(localeLabel('ja').tag).toBe('JA');
  });

  it('reads right to left where the language does', () => {
    expect(localeLabel('ar-AE').dir).toBe('rtl');
    expect(localeLabel('he-IL').dir).toBe('rtl');
    expect(localeLabel('fr-FR').dir).toBe('ltr');
  });

  it('falls back to the tag itself when it names no known language', () => {
    const label = localeLabel('not a locale');

    expect(label.native).toBe('not a locale');
    expect(label.english).toBe('not a locale');
    expect(label.dir).toBe('ltr');
  });

  it('keeps the badge to a couple of characters, whatever the tag', () => {
    // The badge is a fixed square; a tag the registry never bounded cannot be
    // allowed to stretch it.
    expect(localeLabel('not a locale').tag.length).toBeLessThanOrEqual(3);
    expect(localeLabel('es-419').tag.length).toBeLessThanOrEqual(3);
  });
});
