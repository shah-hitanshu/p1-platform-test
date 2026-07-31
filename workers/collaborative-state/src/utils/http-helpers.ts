/**
 * HTTP Response Helpers
 *
 * Utility functions for constructing JSON responses, error responses,
 * and handling CORS headers. Extracted from index.ts.
 */

import {
  buildCorsPatterns,
  addCorsHeaders as sharedAddCorsHeaders,
  handlePreflight as sharedHandlePreflight,
} from './cors';
import type { Env } from '../env';

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
 * Merges system defaults, global env origins, and optional per-site origins.
 */
export function addCorsHeaders(
  response: Response,
  origin: string | null,
  env: Env,
  siteAllowedOrigins?: string[] | null,
): Response {
  const patterns = buildCorsPatterns(env.CORS_ORIGINS, siteAllowedOrigins);
  return sharedAddCorsHeaders(response, origin, patterns, MAIN_ALLOWED_HEADERS);
}

/**
 * Handle CORS preflight requests.
 * Merges system defaults, global env origins, and optional per-site origins.
 */
export function handlePreflight(
  request: Request,
  env: Env,
  siteAllowedOrigins?: string[] | null,
): Response {
  const origin = request.headers.get('Origin');
  const patterns = buildCorsPatterns(env.CORS_ORIGINS, siteAllowedOrigins);
  return sharedHandlePreflight(origin, patterns, MAIN_ALLOWED_HEADERS);
}
