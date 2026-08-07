/**
 * A locale is stored in the casing BCP-47 prescribes, so the same language tag
 * written any other way resolves to one value. Everything downstream reads a
 * locale through this chokepoint, so the dedup check, the variant listing and
 * Accept-Language matching all compare the same normalized form.
 */

import { describe, it, expect } from 'vitest';
import { validateLocale, InvalidLocaleError } from '../../src/services/locale';

describe('validateLocale', () => {
  describe('normalization', () => {
    it('lowercases the language subtag', () => {
      expect(validateLocale('FR')).toBe('fr');
    });

    it('uppercases the region subtag', () => {
      expect(validateLocale('fr-fr')).toBe('fr-FR');
    });

    it('titlecases the script subtag', () => {
      expect(validateLocale('zh-hans-cn')).toBe('zh-Hans-CN');
    });

    it('resolves the same tag written in different casings to one value', () => {
      expect(validateLocale('FR-fr')).toBe(validateLocale('fr-FR'));
      expect(validateLocale('PT-br')).toBe(validateLocale('pt-BR'));
    });

    it('leaves an already-normalized tag unchanged', () => {
      expect(validateLocale('en')).toBe('en');
      expect(validateLocale('pt-BR')).toBe('pt-BR');
      expect(validateLocale('zh-Hans-CN')).toBe('zh-Hans-CN');
    });

    it('leaves a numeric region subtag as written', () => {
      expect(validateLocale('ES-419')).toBe('es-419');
    });

    it('trims surrounding whitespace', () => {
      expect(validateLocale('  fr-FR  ')).toBe('fr-FR');
    });
  });

  describe('rejection', () => {
    it('rejects an empty tag', () => {
      expect(() => validateLocale('')).toThrow(InvalidLocaleError);
      expect(() => validateLocale('   ')).toThrow(InvalidLocaleError);
    });

    it('rejects a tag that is not well-formed', () => {
      expect(() => validateLocale('f')).toThrow(InvalidLocaleError);
      expect(() => validateLocale('french')).toThrow(InvalidLocaleError);
      expect(() => validateLocale('fr_FR')).toThrow(InvalidLocaleError);
      expect(() => validateLocale('fr-')).toThrow(InvalidLocaleError);
    });

    it('reports the tag as given', () => {
      expect(() => validateLocale('fr_FR')).toThrow('"fr_FR" is not a valid locale.');
    });
  });
});
