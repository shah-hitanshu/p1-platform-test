/**
 * Decides whether a caller-proposed redirect origin is trustworthy (PCC-3531).
 * The stored value is where a freshly-authenticated user lands.
 *
 * Do NOT rebuild this on utils/cors.ts buildCorsPatterns or isOriginAllowed:
 * buildCorsPatterns returns wildcard-all for an empty array, so it would honour
 * every proposal on sites that have registered nothing; isOriginAllowed returns
 * true for any localhost origin before consulting a pattern. The parser is shared,
 * so operators still learn one syntax.
 */

import { parseOriginPatterns, type CorsPattern } from '../../utils/cors.js';

export interface ResolveBrokerRedirectParams {
  /** Untrusted. Absent means "no proposal". */
  proposedRedirectUrl?: string;
  fallbackRedirectUrl?: string;
  /** null when the lookup found nothing. */
  allowedOrigins: string[] | null;
  /** Only 'local' relaxes the localhost rule; unset counts as deployed. */
  environment?: string;
}

export interface ResolvedBrokerRedirect {
  /** Undefined stays undefined — the broker then renders a close-window page. */
  redirectUrl?: string;
  /** Set only on rejection. Names the origin and nothing else. */
  warning?: string;
}

// Local development only. sbx1/sandbox/staging are internet-reachable, so a
// localhost redirect there would be an unvalidated target on a public endpoint.
const LOCAL_DEVELOPMENT_ENVIRONMENT = 'local';

function isLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * Matches without the localhost short-circuit, and skips wildcard-all: a legacy
 * bare `*` row would otherwise authorise any redirect at all. Such a row still
 * opens CORS, which was its original purpose.
 */
function matchesRegisteredOrigin(origin: string, patterns: CorsPattern[]): boolean {
  for (const pattern of patterns) {
    switch (pattern.type) {
      case 'wildcard-all':
        continue;
      case 'exact':
        if (pattern.value === origin) return true;
        break;
      case 'wildcard-subdomain':
        if (pattern.regex.test(origin)) return true;
        break;
    }
  }
  return false;
}

/**
 * @returns The URL to store, plus a warning when a proposal was rejected
 */
export function resolveBrokerRedirectUrl(
  params: ResolveBrokerRedirectParams,
): ResolvedBrokerRedirect {
  const { proposedRedirectUrl, fallbackRedirectUrl, allowedOrigins, environment } = params;

  // No proposal: byte-identical to before this feature existed.
  if (proposedRedirectUrl === undefined || proposedRedirectUrl === '') {
    return { redirectUrl: fallbackRedirectUrl };
  }

  const reject = (reason: string): ResolvedBrokerRedirect => ({
    redirectUrl: fallbackRedirectUrl,
    warning: reason,
  });

  // Compare URL().origin, not the raw string: that is what defeats userinfo
  // smuggling like https://registered.example@evil.com. Store the normalised form
  // too, so no consumer can resolve the stored value differently than we checked.
  let proposedOrigin: string;
  let normalisedRedirectUrl: string;
  try {
    const parsed = new URL(proposedRedirectUrl);
    proposedOrigin = parsed.origin;
    normalisedRedirectUrl = parsed.href;
  } catch {
    return reject('proposed redirect URL is not a valid absolute URL; ignoring it');
  }

  // What URL().origin yields for opaque origins (data:, blob:, file:).
  if (proposedOrigin === 'null') {
    return reject('proposed redirect URL has no usable origin; ignoring it');
  }

  if (isLocalhostOrigin(proposedOrigin)) {
    if (environment === LOCAL_DEVELOPMENT_ENVIRONMENT) {
      return { redirectUrl: normalisedRedirectUrl };
    }
    return reject(
      'proposed origin ' + proposedOrigin + ' is a localhost address and is only accepted in local development; ignoring it',
    );
  }

  // Fail-closed: nothing registered, nothing to honour.
  if (allowedOrigins === null || allowedOrigins.length === 0) {
    return reject(
      'proposed origin ' + proposedOrigin + ' cannot be verified because this site has no registered origins; ignoring it',
    );
  }

  const patterns = parseOriginPatterns(allowedOrigins.join(','));
  if (!matchesRegisteredOrigin(proposedOrigin, patterns)) {
    return reject(
      'proposed origin ' + proposedOrigin + ' is not registered for this site; ignoring it',
    );
  }

  return { redirectUrl: normalisedRedirectUrl };
}
