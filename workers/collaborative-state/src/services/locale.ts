/**
 * A document's locale: the language tag its content is written in. A document
 * becomes a translation by sourcing a 'localization' edge, so a locale on its own
 * only labels the language — a source document may name the one it was authored in.
 */

import { InvalidLocaleError } from './errors';

// A permissive BCP-47 shape: a primary language subtag plus optional subtags.
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Rewrites a tag's subtags into the casing BCP-47 prescribes: language lowercase,
 * script titlecase, region uppercase, everything else lowercase. Casing carries no
 * meaning in a language tag — tags compare case-insensitively — so storing one
 * casing is what lets a raw string comparison stand in for that.
 */
function normalizeSubtags(tag: string): string {
  const [language = '', ...rest] = tag.split('-');
  const subtags = rest.map((subtag) => {
    // Script subtags are four letters; regions are two letters or three digits.
    if (subtag.length === 4 && /^[A-Za-z]+$/.test(subtag)) {
      return subtag.slice(0, 1).toUpperCase() + subtag.slice(1).toLowerCase();
    }
    if (subtag.length <= 3) {
      return subtag.toUpperCase();
    }
    return subtag.toLowerCase();
  });
  return [language.toLowerCase(), ...subtags].join('-');
}

/**
 * The locale trimmed of surrounding whitespace and normalized to BCP-47 casing.
 *
 * @throws InvalidLocaleError if the locale is empty or not a well-formed language tag
 */
export function validateLocale(locale: string): string {
  const trimmed = locale.trim();
  if (trimmed === '' || !LOCALE_PATTERN.test(trimmed)) {
    throw new InvalidLocaleError(locale);
  }
  return normalizeSubtags(trimmed);
}
