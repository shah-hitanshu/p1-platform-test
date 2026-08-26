/**
 * A document's locale: the language tag its content is written in. A document
 * becomes a translation by sourcing a 'localization' edge, so a locale on its own
 * only labels the language — a source document may name the one it was authored in.
 */

import languageNames from 'cldr-localenames-full/main/en/languages.json';
import scriptNames from 'cldr-localenames-full/main/en/scripts.json';
import territoryNames from 'cldr-localenames-full/main/en/territories.json';

import { InvalidLocaleError } from './errors';

type SubtagKind = 'language' | 'script' | 'region';

/**
 * CLDR names these, so the lookup below accepts them on its own: `und` is an absent
 * language, `ZZ` and `Zzzz` an unknown region and script.
 */
const placeholders = new Set(['und', 'ZZ', 'Zzzz']);

/**
 * The subtags CLDR names, which bounds what the dashboard can label a locale with.
 * The data is bundled because runtimes disagree on it: workerd's trimmed ICU names
 * 139 of the 190 two-letter languages Node's does, and 1 numeric region of 31.
 */
const subtags: Record<SubtagKind, Set<string>> = {
  language: new Set(Object.keys(languageNames.main.en.localeDisplayNames.languages)),
  script: new Set(Object.keys(scriptNames.main.en.localeDisplayNames.scripts)),
  region: new Set(Object.keys(territoryNames.main.en.localeDisplayNames.territories)),
};

/**
 * An absent subtag names nothing: `und` parses as a locale identifier but carries no
 * language, so it is no locale to publish in.
 */
function isNamed(kind: SubtagKind, subtag: string | undefined): boolean {
  return subtag !== undefined && !placeholders.has(subtag) && subtags[kind].has(subtag);
}

/**
 * Only languages, scripts and regions have data to check against. Variants and
 * extension sequences pass on shape, which parsing has already established.
 */
function isAssigned(locale: Intl.Locale): boolean {
  return (
    isNamed('language', locale.language) &&
    (locale.script === undefined || isNamed('script', locale.script)) &&
    (locale.region === undefined || isNamed('region', locale.region))
  );
}

/**
 * The locale in canonical form: casing normalized, and a deprecated tag resolved
 * to the one that replaced it, so `iw` stores as `he`. One locale therefore has
 * one spelling in storage, which is what lets a raw string comparison stand in
 * for comparing tags.
 *
 * The subtag check reads the canonical form, so a deprecated tag passes only once
 * resolved: CLDR names `he` and `ro`, not `iw` and `mo`.
 *
 * @throws InvalidLocaleError if the tag is not a well-formed Unicode locale
 * identifier, or names a language, script or region CLDR does not name
 */
export function validateLocale(locale: string): string {
  let parsed: Intl.Locale;
  try {
    parsed = new Intl.Locale(locale.trim());
  } catch {
    throw new InvalidLocaleError(locale);
  }

  if (!isAssigned(parsed)) {
    throw new InvalidLocaleError(locale);
  }

  return parsed.toString();
}

/**
 * The tag reduced to the form validateLocale would store, for comparing locales
 * written before storage was canonical — a row holding `iw` still names the same
 * locale as a market stored as `he`. A tag with no canonical form compares as
 * itself.
 */
export function localeKey(locale: string): string {
  try {
    return new Intl.Locale(locale).toString();
  } catch {
    return locale;
  }
}
