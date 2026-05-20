/**
 * URL validation utilities.
 */

/**
 * Accepts an empty string (treated as "no URL"), or any string that parses
 * as a URL whose scheme is http or https. Mirrors the server-side check in
 * workers/src/services/site-service.ts.
 */
export function isValidUrl(value: string): boolean {
  if (value === '') return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
