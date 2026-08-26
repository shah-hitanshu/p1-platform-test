/**
 * A locale is stored in the casing BCP-47 prescribes, so the same language tag
 * written any other way resolves to one value. Everything downstream reads a
 * locale through this chokepoint, so the dedup check, the variant listing and
 * Accept-Language matching all compare the same normalized form.
 */

import { describe, it, expect } from 'vitest';
import { localeKey, validateLocale } from '../../src/services/locale';
import { InvalidLocaleError } from '../../src/services/errors';

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

    it('resolves a deprecated tag to the one that replaced it', () => {
      expect(validateLocale('iw')).toBe('he');
      expect(validateLocale('in')).toBe('id');
      expect(validateLocale('tl')).toBe('fil');
    });

    it('gives one locale one spelling', () => {
      expect(validateLocale('IW')).toBe(validateLocale('he'));
    });

    it('leaves a unicode extension as the caller wrote it', () => {
      expect(validateLocale('de-DE-u-co-phonebk')).toBe('de-DE-u-co-phonebk');
    });

    it('resolves an alias whose replacement is the only tag CLDR names', () => {
      expect(validateLocale('mo')).toBe('ro');
      expect(validateLocale('jw')).toBe('jv');
      expect(validateLocale('bh')).toBe('bho');
    });
  });

  describe('coverage', () => {
    it('accepts a language the deployed runtime carries no data for', () => {
      // The tags workerd's trimmed ICU carries no data for.
      for (const tag of ['bo', 'dz', 'se', 'iu', 'ks', 'ff', 'kl', 'kw', 'nv']) {
        expect(validateLocale(tag)).toBe(tag);
      }
    });

    it('accepts a region that groups countries rather than naming one', () => {
      expect(validateLocale('es-419')).toBe('es-419');
      expect(validateLocale('en-150')).toBe('en-150');
      expect(validateLocale('fr-001')).toBe('fr-001');
    });

    it('accepts a three-letter language', () => {
      expect(validateLocale('yue')).toBe('yue');
      expect(validateLocale('sat')).toBe('sat');
      expect(validateLocale('brx')).toBe('brx');
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

    it('rejects an extended language subtag', () => {
      // Not part of a Unicode locale identifier: `yue` stands on its own.
      expect(() => validateLocale('zh-yue')).toThrow(InvalidLocaleError);
      expect(() => validateLocale('zh-cmn-Hans-CN')).toThrow(InvalidLocaleError);
    });

    it('rejects a language nothing names', () => {
      expect(() => validateLocale('zz')).toThrow(InvalidLocaleError);
      expect(() => validateLocale('qqq')).toThrow(InvalidLocaleError);
      expect(() => validateLocale('und')).toThrow(InvalidLocaleError);
    });

    it('rejects a region nothing names', () => {
      expect(() => validateLocale('en-XX')).toThrow(InvalidLocaleError);
    });

    it('rejects a script nothing names', () => {
      expect(() => validateLocale('en-Abcd')).toThrow(InvalidLocaleError);
    });

    it('rejects the placeholder subtags standing in for an unknown one', () => {
      expect(() => validateLocale('en-ZZ')).toThrow(InvalidLocaleError);
      expect(() => validateLocale('en-Zzzz')).toThrow(InvalidLocaleError);
    });

    it('reports the tag as given', () => {
      expect(() => validateLocale('fr_FR')).toThrow('"fr_FR" is not a valid locale.');
    });
  });
});

describe('localeKey', () => {
  it('reduces a deprecated alias to the tag it stands for', () => {
    expect(localeKey('iw')).toBe('he');
    expect(localeKey('in')).toBe('id');
    expect(localeKey('tl')).toBe('fil');
  });

  it('resolves two spellings of one language to the same key', () => {
    expect(localeKey('iw')).toBe(localeKey('he'));
  });

  it('leaves a current tag as it is', () => {
    expect(localeKey('he')).toBe('he');
    expect(localeKey('pt-BR')).toBe('pt-BR');
    expect(localeKey('zh-Hans-CN')).toBe('zh-Hans-CN');
  });

  it('keeps regional variants of one language distinct', () => {
    expect(localeKey('es-ES')).not.toBe(localeKey('es-MX'));
  });

  it('falls back to the tag itself when there is no canonical form', () => {
    expect(localeKey('en-US-US')).toBe('en-US-US');
  });
});
