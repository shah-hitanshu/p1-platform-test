/**
 * Shared CORS Utility
 *
 * Consolidates CORS logic from index.ts and realtime-api.ts into one module.
 * Adds wildcard pattern matching for subdomain-based deployments.
 *
 * Wildcard rules:
 * - `*` alone matches all origins
 * - `https://*.example.com` matches single-level subdomains (e.g. app.example.com)
 * - Multi-level subdomains (a.b.example.com) do NOT match a single wildcard
 * - Pattern must include protocol (https:// or http://)
 * - Only one wildcard per pattern is allowed
 * - Max 50 patterns enforced
 */

/** Maximum number of origin patterns allowed */
const MAX_PATTERNS = 50;

/** Default allowed headers for main API routes */
const DEFAULT_ALLOWED_HEADERS =
  'Content-Type, Authorization, X-API-Key, X-Principal-Id, X-Principal-Type, X-Actor-Id, X-Actor-Type';

/**
 * A parsed CORS origin pattern.
 */
export type CorsPattern =
  | { type: 'exact'; value: string }
  | { type: 'wildcard-all' }
  | { type: 'wildcard-subdomain'; regex: RegExp };

/**
 * Escape regex special characters except `*` (handled separately).
 */
function escapeRegex(str: string): string {
  return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a comma-separated CORS_ORIGINS string into structured patterns.
 *
 * @param corsOrigins - Comma-separated list of allowed origins
 * @returns Array of parsed patterns (max 50)
 */
export function parseOriginPatterns(corsOrigins: string): CorsPattern[] {
  const raw = corsOrigins
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');

  const patterns: CorsPattern[] = [];

  for (const entry of raw) {
    if (patterns.length >= MAX_PATTERNS) break;

    // Match-all wildcard
    if (entry === '*') {
      patterns.push({ type: 'wildcard-all' });
      continue;
    }

    // Must have a protocol
    if (!/^https?:\/\//.test(entry)) {
      continue;
    }

    // Check for wildcard in the pattern
    const wildcardCount = (entry.match(/\*/g) ?? []).length;

    if (wildcardCount === 0) {
      // Exact match
      patterns.push({ type: 'exact', value: entry });
    } else if (wildcardCount === 1) {
      // Single wildcard — convert to regex
      // `*` matches a single DNS label: one or more alphanumeric/hyphen chars (no dots)
      const escaped = escapeRegex(entry).replace(/\*/g, '[a-zA-Z0-9-]+');
      patterns.push({
        type: 'wildcard-subdomain',
        regex: new RegExp(`^${escaped}$`),
      });
    }
    // Multiple wildcards: skip (invalid)
  }

  return patterns;
}

/**
 * Returns true for any localhost or 127.0.0.1 origin, regardless of port or protocol.
 * Localhost is always allowed as a system default for local development.
 */
function isLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * Check whether an origin is allowed by the parsed patterns.
 *
 * localhost and 127.0.0.1 (any port, any protocol) are always allowed as a
 * system default so local development works without any configuration.
 *
 * @param origin - The request Origin header value (may be null)
 * @param patterns - Parsed CORS patterns
 * @returns true if the origin is allowed
 */
export function isOriginAllowed(
  origin: string | null,
  patterns: CorsPattern[],
): boolean {
  if (origin === null || origin === '') return false;
  if (isLocalhostOrigin(origin)) return true;

  for (const p of patterns) {
    switch (p.type) {
      case 'wildcard-all':
        return true;
      case 'exact':
        if (p.value === origin) return true;
        break;
      case 'wildcard-subdomain':
        if (p.regex.test(origin)) return true;
        break;
    }
  }

  return false;
}

/**
 * Build CORS response headers for a given origin.
 *
 * When the pattern set is a blanket wildcard (default-open mode), emits the
 * literal `*` value and omits `Access-Control-Allow-Credentials`. Browsers
 * reject reflected-origin + credentials responses from wildcard-intended APIs,
 * and omitting credentials prevents authenticated cross-origin reads even when
 * the auth flow uses bearer tokens rather than cookies.
 *
 * When the pattern set is an explicit list (opted-in restriction mode), reflects
 * the specific origin with `Allow-Credentials: true` so credentialed requests
 * from configured origins work correctly.
 *
 * Returns headers with an empty Allow-Origin when origin is not allowed,
 * so callers can always spread the result without branching.
 *
 * @param origin - Request Origin header
 * @param patterns - Parsed CORS patterns
 * @param allowedHeaders - Override for Access-Control-Allow-Headers
 */
export function getCorsHeaders(
  origin: string | null,
  patterns: CorsPattern[],
  allowedHeaders?: string,
): Record<string, string> {
  const isWildcardAll = patterns.some((p) => p.type === 'wildcard-all');

  if (isWildcardAll) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
      'Access-Control-Max-Age': '86400',
    };
  }

  const allowed = isOriginAllowed(origin, patterns);
  const effectiveOrigin = allowed && origin !== null ? origin : '';

  return {
    'Access-Control-Allow-Origin': effectiveOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Clone a response with CORS headers added.
 *
 * Skips WebSocket upgrade responses (they have a `webSocket` property)
 * and responses where the origin is not allowed.
 *
 * @param response - Original response
 * @param origin - Request Origin header
 * @param patterns - Parsed CORS patterns
 * @param allowedHeaders - Override for Access-Control-Allow-Headers
 */
export function addCorsHeaders(
  response: Response,
  origin: string | null,
  patterns: CorsPattern[],
  allowedHeaders?: string,
): Response {
  // WebSocket upgrade responses cannot be modified
  if (
    'webSocket' in response &&
    (response as { webSocket: unknown }).webSocket != null
  ) {
    return response;
  }

  if (origin === null || origin === '' || !isOriginAllowed(origin, patterns)) {
    return response;
  }

  const corsHeaders = getCorsHeaders(origin, patterns, allowedHeaders);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Handle a CORS preflight (OPTIONS) request.
 *
 * @param origin - Request Origin header
 * @param patterns - Parsed CORS patterns
 * @param allowedHeaders - Override for Access-Control-Allow-Headers
 * @returns 204 if allowed, 403 if not
 */
export function handlePreflight(
  origin: string | null,
  patterns: CorsPattern[],
  allowedHeaders?: string,
): Response {
  if (origin === null || origin === '' || !isOriginAllowed(origin, patterns)) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin, patterns, allowedHeaders),
  });
}

/**
 * Build the CORS pattern set for a request.
 *
 * Default behaviour (no allowed_origins configured): wildcard — all origins
 * are permitted. This keeps existing sites working without any configuration.
 *
 * Opted-in behaviour (allowed_origins is non-empty): the wildcard is replaced
 * by the explicit list. Only configured origins (plus the global CORS_ORIGINS
 * env and localhost, which isOriginAllowed always permits) are accepted.
 *
 * @param envCorsOrigins - Value of the CORS_ORIGINS environment variable
 * @param siteAllowedOrigins - Per-site origins from app.sites.allowed_origins;
 *   null or empty means "not configured" → use wildcard default.
 */
export function buildCorsPatterns(
  envCorsOrigins: string | undefined,
  siteAllowedOrigins?: string[] | null,
): CorsPattern[] {
  if (siteAllowedOrigins == null || siteAllowedOrigins.length === 0) {
    // Default open: wildcard allows all origins. Per-request enforcement only
    // activates when a site has explicitly configured allowed_origins.
    return [{ type: 'wildcard-all' }];
  }
  // Opted-in to restriction: configured origins replace the wildcard.
  // localhost is always allowed via isLocalhostOrigin() in isOriginAllowed().
  const site = parseOriginPatterns(siteAllowedOrigins.join(','));
  const global = parseOriginPatterns(envCorsOrigins ?? '');
  return [...site, ...global].slice(0, MAX_PATTERNS);
}
