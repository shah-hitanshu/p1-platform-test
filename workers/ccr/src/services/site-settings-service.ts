/**
 * Site Settings Service
 *
 * Manages per-site cache TTL settings with defaults and overrides.
 * Settings are stored in the JSONB `settings` column on app.sites.
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

import { query } from '../db';
import { InvalidSettingsError, InvalidLocaleError } from './errors';
import { localeKey, validateLocale } from './locale';

// =============================================================================
// Types
// =============================================================================

/**
 * What a visitor in a market gets for a page with no translation in it. Stored
 * here; what serves the page decides how to honour it.
 */
export type LocalePolicy = 'fallback' | 'localized-only';

/**
 * The locales a site publishes in. `markets` is ordered, and that order is the
 * one editors see.
 *
 * There is no site-wide original: a translation derives from whichever document
 * it was made from, recorded as a 'localization' edge. The registry records what
 * a site publishes, and document writes do not consult it, so a translation can
 * exist in a locale no market names.
 */
export interface SiteLocales {
  markets: string[];
  policy: LocalePolicy;
}

/**
 * Per-site settings stored in the JSONB `settings` column.
 *
 * The social defaults are site-wide fallbacks for page metadata: a page that
 * leaves og:image or og:locale empty inherits these at render time.
 */
export interface SiteSettings {
  cacheTtlMain?: number;
  cacheTtlBranch?: number;
  ogImage?: string;
  ogLocale?: string;
  locales?: SiteLocales;
}

/**
 * Settings with the values that always resolve. The TTLs have hardcoded
 * defaults; the social defaults are absent until a site sets them.
 */
export type EffectiveSiteSettings = SiteSettings & {
  cacheTtlMain: number;
  cacheTtlBranch: number;
};

/**
 * A settings write. `null` removes the key, falling back to the default.
 */
export interface SiteSettingsUpdate {
  cacheTtlMain?: number | null;
  cacheTtlBranch?: number | null;
  ogImage?: string | null;
  ogLocale?: string | null;
  /**
   * The registry is written whole: a write replaces the stored block rather than
   * merging into it, so a caller sends every market and the policy together.
   * `null` clears it, leaving the site with no locales.
   */
  locales?: SiteLocales | null;
}

/**
 * Environment-level default overrides passed at runtime.
 */
export interface EnvDefaults {
  defaultCacheTtlMain?: number;
  defaultCacheTtlBranch?: number;
}

/**
 * Database row shape for the settings query.
 */
interface SettingsRow {
  settings: SiteSettings | string;
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_CACHE_TTL_MAIN = 60;
const DEFAULT_CACHE_TTL_BRANCH = 5;

const DEFAULT_SETTINGS = {
  cacheTtlMain: DEFAULT_CACHE_TTL_MAIN,
  cacheTtlBranch: DEFAULT_CACHE_TTL_BRANCH,
};

/** Long enough for a signed CDN URL. */
const MAX_OG_IMAGE_LENGTH = 2048;
const MAX_OG_LOCALE_LENGTH = 35;

const LOCALE_POLICIES: LocalePolicy[] = ['fallback', 'localized-only'];

/** Clear of any real publisher: CLDR names 666 languages in all. */
export const MAX_MARKETS = 1000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parses settings from the database.
 * Handles both string (JSON) and object formats for JSONB columns.
 */
function parseSettings(value: SiteSettings | string): SiteSettings {
  if (typeof value === 'string') {
    return JSON.parse(value) as SiteSettings;
  }
  return value;
}

/**
 * Merges stored settings with defaults, producing the effective settings.
 */
function mergeWithDefaults(settings: SiteSettings): EffectiveSiteSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
  };
}

/**
 * Validates that a cache TTL value is a positive integer no greater than one
 * day. The ceiling bounds how long stale content (and, for a non-main branch,
 * a draft served before the PCC-3676 gate was in place) can persist in a cache.
 */
const MAX_CACHE_TTL_SECONDS = 86_400;

function validateTtlField(field: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_CACHE_TTL_SECONDS
  ) {
    throw new InvalidSettingsError(
      `${field} must be a positive integer no greater than ${String(MAX_CACHE_TTL_SECONDS)} (one day), got ${String(typeof value === 'number' ? value : typeof value)}`,
    );
  }
}

/**
 * Validates a social default. Blank is rejected rather than stored, since a
 * stored empty string would shadow the absent-means-omit-the-tag case; `null`
 * is how a caller clears one.
 */
function validateTextField(field: string, value: unknown, maxLength: number): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== 'string') {
    throw new InvalidSettingsError(`${field} must be a string, got ${typeof value}`);
  }
  if (value.trim() === '') {
    throw new InvalidSettingsError(`${field} must not be blank; pass null to clear it`);
  }
  if (value.length > maxLength) {
    throw new InvalidSettingsError(`${field} must be at most ${String(maxLength)} characters`);
  }
}

/**
 * A language tag in its stored casing. A malformed tag surfaces as an invalid
 * setting, which is what the settings route answers 400 for.
 */
function validateLocaleField(field: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidSettingsError(`${field} must be a language tag, got ${typeof value}`);
  }
  try {
    return validateLocale(value);
  } catch (error) {
    if (error instanceof InvalidLocaleError) {
      throw new InvalidSettingsError(`${field} is not a well-formed language tag: "${value}"`);
    }
    throw error;
  }
}

/**
 * The locale registry with every tag normalized, ready to store.
 *
 * A market naming a locale the site already publishes is rejected, since two
 * tags for one locale would each carry half of its translations and neither
 * would be complete. Tags are canonical by the time they are compared, so `iw`
 * and `he` are one locale while `es-ES` and `es-MX` are two.
 */
function validateLocales(value: unknown): SiteLocales {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidSettingsError('locales must be an object with markets and policy');
  }

  const { markets, policy } = value as Record<string, unknown>;

  if (!Array.isArray(markets)) {
    throw new InvalidSettingsError('locales.markets must be an array of language tags');
  }
  if (markets.length > MAX_MARKETS) {
    throw new InvalidSettingsError(
      `locales.markets must name at most ${String(MAX_MARKETS)} locales`,
    );
  }
  if (typeof policy !== 'string' || !LOCALE_POLICIES.includes(policy as LocalePolicy)) {
    throw new InvalidSettingsError(
      `locales.policy must be one of ${LOCALE_POLICIES.join(', ')}`,
    );
  }

  const published = new Set<string>();

  const normalizedMarkets = markets.map((market, index) => {
    const normalized = validateLocaleField(`locales.markets[${String(index)}]`, market);
    if (published.has(normalized)) {
      throw new InvalidSettingsError(
        `locales.markets[${String(index)}] "${normalized}" names a locale the site already publishes`,
      );
    }
    published.add(normalized);
    return normalized;
  });

  return {
    markets: normalizedMarkets,
    policy: policy as LocalePolicy,
  };
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Retrieves the settings for a site, merged with defaults.
 *
 * @param siteId - The site ID
 * @returns The site settings merged with defaults, or null if site not found
 */
export async function getSiteSettings(
  siteId: string,
): Promise<EffectiveSiteSettings | null> {
  const result = await query<SettingsRow>(
    'SELECT settings FROM app.sites WHERE id = $1',
    [siteId],
  );

  if (!result.rows[0]) {
    return null;
  }

  const raw = parseSettings(result.rows[0].settings);
  return mergeWithDefaults(raw);
}

/**
 * Updates site settings via JSONB merge. Null values remove keys.
 *
 * @param siteId - The site ID
 * @param settings - Partial settings to merge (null values remove keys)
 * @returns The updated settings merged with defaults, or null if site not found
 * @throws InvalidSettingsError if any value fails its field's validation
 */
export async function updateSiteSettings(
  siteId: string,
  settings: SiteSettingsUpdate,
): Promise<EffectiveSiteSettings | null> {
  // Validate fields first
  validateTtlField('cacheTtlMain', settings.cacheTtlMain);
  validateTtlField('cacheTtlBranch', settings.cacheTtlBranch);
  validateTextField('ogImage', settings.ogImage, MAX_OG_IMAGE_LENGTH);
  validateTextField('ogLocale', settings.ogLocale, MAX_OG_LOCALE_LENGTH);

  // Locales are stored normalized, so the write carries the validated block.
  const writable: SiteSettingsUpdate =
    settings.locales === undefined || settings.locales === null
      ? settings
      : { ...settings, locales: validateLocales(settings.locales) };

  // Separate keys to set vs keys to remove (null values)
  const keysToRemove: string[] = [];
  const keysToSet: Record<string, number | string | SiteLocales> = {};

  const entries = Object.entries(writable) as [
    string,
    number | string | SiteLocales | null | undefined,
  ][];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (value === null) {
      keysToRemove.push(key);
    } else {
      keysToSet[key] = value;
    }
  }

  // A jsonb bind carries the object itself. postgres.js serializes a jsonb
  // parameter, so a pre-stringified value is JSON-encoded twice and Postgres
  // stores a string scalar — which `||` appends to rather than merges.
  let sql: string;
  let params: unknown[];

  if (keysToRemove.length > 0 && Object.keys(keysToSet).length > 0) {
    // Both merge and remove
    sql = `UPDATE app.sites
           SET settings = (settings || $1::jsonb) - $2::text[],
               updated_at = NOW()
           WHERE id = $3
           RETURNING settings`;
    params = [keysToSet, keysToRemove, siteId];
  } else if (keysToRemove.length > 0) {
    // Only remove keys
    sql = `UPDATE app.sites
           SET settings = settings - $1::text[],
               updated_at = NOW()
           WHERE id = $2
           RETURNING settings`;
    params = [keysToRemove, siteId];
  } else {
    // Only merge
    sql = `UPDATE app.sites
           SET settings = settings || $1::jsonb,
               updated_at = NOW()
           WHERE id = $2
           RETURNING settings`;
    params = [keysToSet, siteId];
  }

  const result = await query<SettingsRow>(sql, params);

  if (!result.rows[0]) {
    return null;
  }

  const raw = parseSettings(result.rows[0].settings);
  return mergeWithDefaults(raw);
}

/**
 * Document counts for the locales a site publishes, keyed by the registry's own
 * tags so a count can be read straight off a market row.
 *
 * The tag stored on a document need not be the tag the registry uses for the
 * same locale: a site whose pages were written `iw` may publish it as market
 * `he`. Documents are matched to a market by canonical tag, and a locale holding
 * nothing is absent rather than zero.
 */
export function localeCountsForRegistry(
  locales: SiteLocales,
  documentCounts: Record<string, number>,
): Record<string, number> {
  const byLocale = new Map<string, number>();
  for (const [tag, count] of Object.entries(documentCounts)) {
    const locale = localeKey(tag);
    byLocale.set(locale, (byLocale.get(locale) ?? 0) + count);
  }

  const counts: Record<string, number> = {};
  for (const tag of locales.markets) {
    const count = byLocale.get(localeKey(tag));
    if (count !== undefined) {
      counts[tag] = count;
    }
  }

  return counts;
}

/**
 * Computes the effective cache TTL for a branch.
 * Priority: site override > env default > hardcoded default.
 *
 * @param siteSettings - The site's settings (may be partial, or null when the site row is missing)
 * @param isMainBranch - Whether this is the main branch
 * @param envDefaults - Optional environment-level defaults
 * @returns The effective cache TTL in seconds
 */
export function getEffectiveCacheTtl(
  siteSettings: SiteSettings | null,
  isMainBranch: boolean,
  envDefaults?: EnvDefaults,
): number {
  if (isMainBranch) {
    return (
      siteSettings?.cacheTtlMain ??
      envDefaults?.defaultCacheTtlMain ??
      DEFAULT_CACHE_TTL_MAIN
    );
  }

  return (
    siteSettings?.cacheTtlBranch ??
    envDefaults?.defaultCacheTtlBranch ??
    DEFAULT_CACHE_TTL_BRANCH
  );
}
