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
