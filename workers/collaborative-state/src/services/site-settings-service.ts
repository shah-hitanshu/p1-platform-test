/**
 * Site Settings Service
 *
 * Manages per-site cache TTL settings with defaults and overrides.
 * Settings are stored in the JSONB `settings` column on app.sites.
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

import { query } from '../db';

// =============================================================================
// Types
// =============================================================================

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
// Error Classes
// =============================================================================

/**
 * Error thrown when site settings values are invalid.
 */
export class InvalidSettingsError extends Error {
  public readonly name = 'InvalidSettingsError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidSettingsError.prototype);
  }
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
 * Validates that a cache TTL value is a positive integer.
 */
function validateTtlField(field: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new InvalidSettingsError(
      `${field} must be a positive integer, got ${String(typeof value === 'number' ? value : typeof value)}`,
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
 * @throws InvalidSettingsError if values are not positive integers
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

  // Separate keys to set vs keys to remove (null values)
  const keysToRemove: string[] = [];
  const keysToSet: Record<string, number | string> = {};

  const entries = Object.entries(settings) as [string, number | string | null | undefined][];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (value === null) {
      keysToRemove.push(key);
    } else {
      keysToSet[key] = value;
    }
  }

  let sql: string;
  let params: unknown[];

  if (keysToRemove.length > 0 && Object.keys(keysToSet).length > 0) {
    // Both merge and remove
    sql = `UPDATE app.sites
           SET settings = (settings || $1::jsonb) - $2::text[],
               updated_at = NOW()
           WHERE id = $3
           RETURNING settings`;
    params = [JSON.stringify(keysToSet), keysToRemove, siteId];
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
    params = [JSON.stringify(keysToSet), siteId];
  }

  const result = await query<SettingsRow>(sql, params);

  if (!result.rows[0]) {
    return null;
  }

  const raw = parseSettings(result.rows[0].settings);
  return mergeWithDefaults(raw);
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
