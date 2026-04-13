/**
 * OAuth Redirect URI Origin Validator
 *
 * Validates OAuth redirect URIs against a site's allowedOrigins list.
 * Supports exact matches and wildcard prefix patterns for Pantheon branch URLs.
 *
 * SECURITY: This function enforces that redirect URIs are strictly controlled
 * by the site operator. Incorrect implementation here could allow arbitrary
 * sites to abuse the CSS Google OAuth Client ID.
 *
 * Wildcard pattern syntax:
 *   *-mysite.pantheonsite.io  — matches live-mysite.pantheonsite.io, dev-mysite.pantheonsite.io, etc.
 *   The wildcard only replaces the leftmost label and is anchored to the full hostname.
 *
 * Non-wildcard patterns are treated as exact origin strings (scheme + host + port).
 */

/**
 * Checks if a redirect URI's origin matches any pattern in the allowedOrigins list.
 *
 * @param redirectUri - The full redirect URI from the OAuth authorization request
 * @param allowedOrigins - The site's configured origin patterns
 * @returns true if the redirect URI is allowed, false otherwise
 *
 * @security OPERATOR TRUST MODEL — Wildcard patterns (e.g. `*-mysite.pantheonsite.io`)
 * are not restricted to Pantheon-owned domains at the code level. The security model
 * delegates that responsibility to the operator: only Pantheon-provided hostnames
 * should appear in a site's `allowedOrigins` list. A misconfigured wildcard for an
 * arbitrary domain (e.g. `*-evil.com`) would allow any single-label subdomain of
 * that domain to authorize against this client. Pantheon's infrastructure controls
 * (site-api access controls, admin-only configuration) are the enforcement boundary.
 */
export function matchesAllowedOrigin(
  redirectUri: string,
  allowedOrigins: string[],
): boolean {
  if (!redirectUri || allowedOrigins.length === 0) {
    return false;
  }

  // Parse the redirect URI to extract the origin (scheme + host + port)
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false; // Malformed URL
  }

  const redirectOrigin = parsed.origin; // e.g. "https://mysite.com"
  const redirectHostname = parsed.hostname; // e.g. "mysite.com"
  const redirectScheme = parsed.protocol; // e.g. "https:"

  for (const pattern of allowedOrigins) {
    if (matchesSinglePattern(redirectOrigin, redirectHostname, redirectScheme, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a single origin pattern matches the redirect URI's origin.
 *
 * @security OPERATOR TRUST — Wildcard patterns (`*-suffix`) are evaluated without
 * restricting the suffix to any specific domain registrar or TLD. This is by design:
 * Pantheon operators configure `allowedOrigins` via the site-api, and Pantheon's
 * access controls ensure only trusted administrators may set these values. In practice,
 * only Pantheon-managed hostnames (e.g. `*.pantheonsite.io` or custom domains) should
 * appear here. See also `matchesAllowedOrigin()` for the full security context.
 */
function matchesSinglePattern(
  redirectOrigin: string,
  redirectHostname: string,
  redirectScheme: string,
  pattern: string,
): boolean {
  if (pattern.startsWith('*-')) {
    return matchesWildcardPattern(redirectHostname, redirectScheme, pattern);
  }

  // Exact origin match (normalize trailing slash)
  const normalizedPattern = pattern.replace(/\/$/, '');
  const normalizedOrigin = redirectOrigin.replace(/\/$/, '');
  return normalizedOrigin === normalizedPattern;
}

/**
 * Validate a wildcard pattern match.
 *
 * Pattern: *-mysite.pantheonsite.io
 * The wildcard replaces the leftmost label. The rest of the hostname must
 * exactly match the pattern suffix (anchored to the right).
 *
 * SECURITY: We verify:
 * 1. The scheme is https (wildcards only allowed for secure origins)
 * 2. The hostname ends with the exact suffix (anchored — not substring match)
 * 3. The prefix before the suffix is exactly one label (no dots) and non-empty
 *    — this prevents "sub.live-mysite.pantheonsite.io" and
 *      "live-mysite.pantheonsite.io.evil.com"
 */
function matchesWildcardPattern(
  hostname: string,
  scheme: string,
  pattern: string,
): boolean {
  // Wildcards only apply to https origins
  if (scheme !== 'https:') {
    return false;
  }

  // Extract the suffix after the '*' (e.g. "-mysite.pantheonsite.io")
  const suffix = pattern.slice(1); // "-mysite.pantheonsite.io"

  // The hostname must end with the exact suffix
  if (!hostname.endsWith(suffix)) {
    return false;
  }

  // Extract the prefix label (everything before the suffix)
  const prefixLabel = hostname.slice(0, hostname.length - suffix.length);

  // The prefix must be non-empty and must be a single label (no dots)
  if (prefixLabel.length === 0 || prefixLabel.includes('.')) {
    return false;
  }

  return true;
}
