/**
 * Shared CORS Utility
 *
 * Consolidates CORS logic with wildcard pattern support.
 * Used by both index.ts (main API) and realtime-api.ts.
 *
 * Stub — to be implemented after tests are committed.
 */

export type CorsPattern =
  | { type: 'exact'; value: string }
  | { type: 'wildcard-all' }
  | { type: 'wildcard-subdomain'; regex: RegExp };

export function parseOriginPatterns(_corsOrigins: string): CorsPattern[] {
  throw new Error('Not implemented');
}

export function isOriginAllowed(_origin: string | null, _patterns: CorsPattern[]): boolean {
  throw new Error('Not implemented');
}

export function getCorsHeaders(
  _origin: string | null,
  _patterns: CorsPattern[],
  _allowedHeaders?: string,
): Record<string, string> {
  throw new Error('Not implemented');
}

export function addCorsHeaders(
  _response: Response,
  _origin: string | null,
  _patterns: CorsPattern[],
  _allowedHeaders?: string,
): Response {
  throw new Error('Not implemented');
}

export function handlePreflight(
  _origin: string | null,
  _patterns: CorsPattern[],
  _allowedHeaders?: string,
): Response {
  throw new Error('Not implemented');
}
