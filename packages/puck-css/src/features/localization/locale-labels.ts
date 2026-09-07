/**
 * Locale Labels
 *
 * A market arrives as a BCP-47 tag. Editors read languages, not tags, so each
 * one is shown three ways: its own name for itself, its name in English, and a
 * badge short enough for a fixed square.
 */

/** Languages written right to left, by ISO 639-1 code. */
const RTL_LANGUAGES = new Set([
  'ar',
  'ckb',
  'dv',
  'fa',
  'he',
  'ps',
  'sd',
  'ug',
  'ur',
  'yi',
]);

export interface LocaleLabel {
  /**
   * The market's own name for itself, region or script included, e.g.
   * "Français (France)". Two markets of one language are named apart here:
   * "Português (Brasil)" against "Português europeu".
   */
  native: string;
  /** The locale's name in English, region included, e.g. "French (France)". */
  english: string;
  /** The badge, e.g. "FR". */
  tag: string;
  dir: 'ltr' | 'rtl';
}

const cache = new Map<string, LocaleLabel>();

const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

function displayName(of: string, inLocale: string): string | null {
  try {
    return new Intl.DisplayNames([inLocale], { type: 'language' }).of(of) ?? null;
  } catch {
    // An unregistered or malformed subtag: both the tag being named and the
    // language doing the naming can reject it.
    return null;
  }
}

function build(locale: string): LocaleLabel {
  let language = '';
  let region: string | undefined;
  try {
    const parsed = new Intl.Locale(locale);
    language = parsed.language;
    region = parsed.region;
  } catch {
    // Not a tag at all — nothing to read off it.
  }

  // Named from the whole tag rather than its language: a language alone cannot
  // tell two of a site's markets apart, and this name is all some fields show.
  const native = displayName(locale, locale) ?? (language ? displayName(language, locale) : null);
  const english = displayName(locale, 'en');
  const badge = (region || language || locale).toUpperCase();

  return {
    native: native === null ? locale : capitalize(native),
    english: english ?? locale,
    // A locale the registry never bounded still has to fit the badge.
    tag: badge.slice(0, 3),
    dir: RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr',
  };
}

export function localeLabel(locale: string): LocaleLabel {
  const cached = cache.get(locale);
  if (cached) return cached;
  const label = build(locale);
  cache.set(locale, label);
  return label;
}
