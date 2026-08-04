/**
 * API Route Validation Utilities
 *
 * Shared validation functions for request parameters.
 */

/**
 * Pagination validation constants
 */
export const PAGINATION = {
  MAX_LIMIT: 100,
  DEFAULT_LIMIT: 20,
  MIN_LIMIT: 1,
  MIN_OFFSET: 0,
} as const;

/**
 * Validation result for pagination parameters
 */
export interface PaginationValidation {
  valid: boolean;
  limit?: number;
  offset?: number;
  error?: string;
}

/**
 * Validates and normalizes pagination parameters from query string.
 *
 * @param limitParam - The limit query parameter value (or null)
 * @param offsetParam - The offset query parameter value (or null)
 * @returns Validation result with normalized values or error message
 */
export function validatePagination(
  limitParam: string | null,
  offsetParam: string | null,
): PaginationValidation {
  let limit: number | undefined;
  let offset: number | undefined;

  // Parse and validate limit
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed)) {
      return { valid: false, error: 'limit must be a valid number' };
    }
    if (parsed < PAGINATION.MIN_LIMIT) {
      return { valid: false, error: 'limit must be at least ' + String(PAGINATION.MIN_LIMIT) };
    }
    if (parsed > PAGINATION.MAX_LIMIT) {
      return { valid: false, error: 'limit cannot exceed ' + String(PAGINATION.MAX_LIMIT) };
    }
    limit = parsed;
  }

  // Parse and validate offset
  if (offsetParam !== null) {
    const parsed = parseInt(offsetParam, 10);
    if (isNaN(parsed)) {
      return { valid: false, error: 'offset must be a valid number' };
    }
    if (parsed < PAGINATION.MIN_OFFSET) {
      return { valid: false, error: 'offset must be at least ' + String(PAGINATION.MIN_OFFSET) };
    }
    offset = parsed;
  }

  return { valid: true, limit, offset };
}

/**
 * Size limits for various inputs
 */
export const SIZE_LIMITS = {
  MAX_SCHEMA_SIZE_BYTES: 64 * 1024, // 64KB
  MAX_METADATA_SIZE_BYTES: 64 * 1024, // 64KB
  MAX_NAME_LENGTH: 255,
  MAX_SLUG_LENGTH: 255,
  MAX_DESCRIPTION_LENGTH: 2000,
} as const;

/**
 * Estimates the JSON size of an object in bytes.
 */
export function estimateJsonSize(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

/** Matches MAX_PATTERNS in utils/cors.ts; entries beyond it never take effect. */
export const MAX_ALLOWED_ORIGINS = 50;

/**
 * Mirrors what utils/cors.ts parseOriginPatterns accepts, and additionally
 * rejects patterns that parse but are too broad to be safe.
 *
 * Collects every applicable reason rather than stopping at the first, so a
 * caller sees all of an entry's problems in one round trip.
 *
 * @param entry - Candidate pattern
 * @returns All reasons the entry is invalid; empty when it is acceptable
 */
function validateOriginPattern(entry: string): string[] {
  if (entry === '') {
    return ['must not be empty'];
  }

  // Parses to wildcard-all, permitting every origin.
  if (entry === '*') {
    return ['must not be a bare wildcard; list origins explicitly'];
  }

  // Readers parse the stored array by joining it with commas (see
  // validateAllowedOriginPatterns), so a comma inside a single entry would
  // become a pattern separator and one row would expand into several.
  // Security-review follow-up (e63a0d67): rejected outright, since there is no
  // legitimate use case for a comma inside one entry — each origin is its own
  // array entry — and splitting instead of rejecting would let one API call
  // smuggle several origins in behind what looks like one entry.
  if (entry.includes(',')) {
    return ['must not contain a comma; add each origin as its own entry'];
  }

  const reasons: string[] = [];

  // parseOriginPatterns silently skips entries without a protocol, so they would
  // store cleanly and match nothing.
  const hasProtocol = /^https?:\/\//.test(entry);
  if (!hasProtocol) {
    reasons.push('must start with https:// or http://');
  }

  const wildcardCount = (entry.match(/\*/g) ?? []).length;
  if (wildcardCount > 1) {
    reasons.push('must contain at most one *');
  }

  // The remaining checks need a parseable host, which requires a protocol.
  if (hasProtocol) {
    // An Origin header never carries a path, query or fragment, so such an entry
    // could never match. Checked on the raw string: a wildcard breaks URL().
    const afterProtocol = entry.slice(entry.indexOf('://') + 3);
    if (afterProtocol === '') {
      reasons.push('must include a host');
    } else {
      if (/[/?#]/.test(afterProtocol)) {
        reasons.push('must be an origin only, with no path, query or trailing slash');
      }

      if (wildcardCount === 1) {
        // Strip any path/query/fragment first so it can't skew the label count.
        const [hostOnly = ''] = afterProtocol.split(/[/?#]/);
        const labels = hostOnly.split('.');
        // split() always yields at least one element; the default is for
        // noUncheckedIndexedAccess, which types labels[0] as possibly undefined.
        const [leftmostLabel = ''] = labels;

        // '*' expands to one DNS label, so only the leftmost position is meaningful.
        if (!leftmostLabel.includes('*')) {
          reasons.push('may only use * in the leftmost label');
        } else if (labels.length < 3) {
          // Blocks https://*.com, where the wildcard sits on a public suffix and
          // matches every domain under it. Limitation: no public-suffix list, so
          // *.co.uk passes; tightening that needs a PSL.
          reasons.push(
            'is too broad; * must be below a registrable domain (e.g. https://*-site.pantheonsite.io)',
          );
        }
      }
    }
  }

  return reasons;
}

/**
 * Validates allowed-origin patterns submitted for a site.
 *
 * Diff-scoped: only entries not already stored are checked. Callers resend the
 * whole array on every change, so validating all of it would leave a site holding
 * a legacy invalid row unable to remove it.
 *
 * Every invalid entry (and every reason each one fails) is collected into a
 * single message, rather than returning as soon as the first is found.
 *
 * @param nextOrigins - The full array the caller wants to store
 * @param storedOrigins - Origins currently stored for the site, if any
 * @returns Message describing every offending entry, or undefined if acceptable
 */
export function validateAllowedOriginPatterns(
  nextOrigins: string[],
  storedOrigins?: string[],
): string | undefined {
  if (nextOrigins.length > MAX_ALLOWED_ORIGINS) {
    return (
      'allowedOrigins cannot exceed ' + String(MAX_ALLOWED_ORIGINS) + ' entries'
    );
  }

  const alreadyStored = new Set(storedOrigins ?? []);
  const failures: string[] = [];

  for (const entry of nextOrigins) {
    if (alreadyStored.has(entry)) {
      continue;
    }

    const reasons = validateOriginPattern(entry);
    if (reasons.length > 0) {
      failures.push('allowedOrigins entry "' + entry + '" ' + reasons.join('; and '));
    }
  }

  if (failures.length > 0) {
    return failures.join(' | ');
  }

  return undefined;
}

/**
 * Validates that a JSON object doesn't exceed the size limit.
 *
 * @param obj - Object to validate
 * @param maxBytes - Maximum allowed size in bytes
 * @param fieldName - Field name for error message
 * @returns Error message if invalid, undefined if valid
 */
export function validateJsonSize(
  obj: unknown,
  maxBytes: number,
  fieldName: string,
): string | undefined {
  if (obj === undefined || obj === null) {
    return undefined;
  }

  const size = estimateJsonSize(obj);
  if (size > maxBytes) {
    const maxKb = Math.round(maxBytes / 1024);
    return fieldName + ' exceeds maximum size of ' + String(maxKb) + 'KB';
  }

  return undefined;
}
