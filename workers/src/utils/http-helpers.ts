/**
 * HTTP Response Helpers
 *
 * Utility functions for constructing JSON responses, error responses,
 * and handling CORS headers. Extracted from index.ts.
 */

import {
  parseOriginPatterns,
  addCorsHeaders as sharedAddCorsHeaders,
  handlePreflight as sharedHandlePreflight,
} from './cors';
import type { Env } from '../index';

/**
 * JSON response helper.
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Error response helper.
 */
export function errorResponse(
  error: string,
  status: number,
  details?: unknown,
): Response {
  return jsonResponse({ error, details }, status);
}

/** Allowed headers for main API routes */
export const MAIN_ALLOWED_HEADERS =
  'Content-Type, Authorization, X-API-Key, X-Principal-Id, X-Principal-Type, X-Actor-Id, X-Actor-Type';

/**
 * Add CORS headers to response based on request origin.
 * Delegates to shared CORS utility with wildcard pattern support.
 */
export function addCorsHeaders(
  response: Response,
  origin: string | null,
  env: Env,
): Response {
  const patterns = parseOriginPatterns(env.CORS_ORIGINS);
  return sharedAddCorsHeaders(response, origin, patterns, MAIN_ALLOWED_HEADERS);
}

/**
 * Handle CORS preflight requests.
 * Delegates to shared CORS utility with wildcard pattern support.
 */
export function handlePreflight(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin');
  const patterns = parseOriginPatterns(env.CORS_ORIGINS);
  return sharedHandlePreflight(origin, patterns, MAIN_ALLOWED_HEADERS);
}
