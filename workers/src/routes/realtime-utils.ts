/**
 * Utility functions and types for Real-Time API Routes
 *
 * Extracted from realtime-api.ts to reduce file size.
 * Contains CORS helpers, route parsing, parameter validation,
 * and agent status checking utilities.
 */

import {
  parseOriginPatterns,
  isOriginAllowed,
  getCorsHeaders as sharedGetCorsHeaders,
  addCorsHeaders as sharedAddCorsHeaders,
  type CorsPattern,
} from '../utils/cors';
import {
  MAX_SITE_ID_LENGTH,
  MAX_BRANCH_ID_LENGTH,
  MAX_DOCUMENT_PATH_LENGTH,
} from '../constants/security-limits';
import { checkAgentStatus } from '../middleware/agent-status-middleware';
import type { AgentContext } from '../services/agent-context-service';
import type { AuthenticatedPrincipal, RolePermissions } from '../types';

/**
 * Environment interface for Durable Object bindings
 */
export interface RealtimeEnv {
  DOCUMENT_STATE: DurableObjectNamespace;
  CORS_ORIGINS?: string; // Comma-separated list of allowed origins
}

/**
 * Route parameters extracted from URL
 */
export interface RouteParams {
  siteId: string;
  branchId: string;
  documentPath: string;
  action?: 'edits' | 'connect' | 'can-agent-edit' | 'agent-edit-start' | 'agent-edit-complete' | 'agent-edit-abort' | 'agent-stop' | 'focus-regions';
}

/** Default allowed origins for development */
export const DEFAULT_CORS_ORIGINS = 'http://localhost:3000,http://localhost:8787';

/** Allowed headers for realtime API routes (includes agent context headers) */
export const REALTIME_ALLOWED_HEADERS = [
  'Content-Type',
  'X-Actor-Id',
  'X-Actor-Type',
  'Upgrade',
  // Phase 7.3: Agent context headers
  'X-Agent-Id',
  'X-Agent-Trigger',
  'X-Agent-Requested-By',
  'X-Agent-Intent',
  'X-Agent-Operation-Type',
  'X-Agent-Target-Regions',
].join(', ');

/**
 * Get CORS headers for a specific origin using shared utility
 */
export function getCorsHeaders(origin: string | null, patterns: CorsPattern[]): Record<string, string> {
  return sharedGetCorsHeaders(origin, patterns, REALTIME_ALLOWED_HEADERS);
}

/**
 * Parse CORS origin patterns from environment variable
 */
export function parseCorsPatterns(corsOrigins: string | undefined): CorsPattern[] {
  const origins = corsOrigins ?? DEFAULT_CORS_ORIGINS;
  return parseOriginPatterns(origins);
}

/**
 * Validate URL parameter lengths
 * Returns error message if invalid, null if valid
 */
export function validateParamLengths(params: RouteParams): string | null {
  if (params.siteId.length > MAX_SITE_ID_LENGTH) {
    return `siteId exceeds maximum length of ${String(MAX_SITE_ID_LENGTH)}`;
  }
  if (params.branchId.length > MAX_BRANCH_ID_LENGTH) {
    return `branchId exceeds maximum length of ${String(MAX_BRANCH_ID_LENGTH)}`;
  }
  if (params.documentPath.length > MAX_DOCUMENT_PATH_LENGTH) {
    return `documentPath exceeds maximum length of ${String(MAX_DOCUMENT_PATH_LENGTH)}`;
  }
  return null;
}

/**
 * Parse route from URL pathname
 * Returns null if the route doesn't match the expected pattern
 */
export function parseRoute(pathname: string): RouteParams | null {
  // Pattern: /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}[/action]
  // Actions: edits, connect, can-agent-edit, agent-edit-start, agent-edit-complete, agent-edit-abort, focus-regions
  const actionPattern = 'edits|connect|can-agent-edit|agent-edit-start|agent-edit-complete|agent-edit-abort|agent-stop|focus-regions';
  const pattern = new RegExp(
    `^/api/sites/([^/]+)/branches/([^/]+)/documents/(.+?)(?:/(${actionPattern}))?$`,
  );

  const match = pattern.exec(pathname);
  if (match === null) {
    return null;
  }

  const [, siteId, branchId, documentPath, action] = match;

  // Validate required parameters are not empty
  if (
    siteId === undefined ||
    siteId === '' ||
    branchId === undefined ||
    branchId === '' ||
    documentPath === undefined ||
    documentPath === ''
  ) {
    return null;
  }

  return {
    siteId: decodeURIComponent(siteId),
    branchId: decodeURIComponent(branchId),
    documentPath: decodeURIComponent(documentPath),
    action: action as RouteParams['action'],
  };
}

/**
 * Generate session ID for Durable Object
 * Format: {siteId}:{documentId}:{branchId}
 *
 * Uses documentId (UUID) instead of documentPath to ensure stable session IDs
 * that survive document renames and match the presence-rollup-service format.
 */
export function generateSessionId(siteId: string, documentId: string, branchId: string): string {
  return `${siteId}:${documentId}:${branchId}`;
}

/**
 * Add CORS headers to a response using shared utility
 */
export function addCorsHeaders(
  response: Response,
  origin: string | null,
  patterns: CorsPattern[],
): Response {
  return sharedAddCorsHeaders(response, origin, patterns, REALTIME_ALLOWED_HEADERS);
}

/**
 * Create JSON error response with CORS headers
 */
export function errorResponse(
  status: number,
  error: string,
  origin: string | null,
  patterns: CorsPattern[],
): Response {
  const corsHeaders = getCorsHeaders(origin, patterns);
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * Handle CORS preflight OPTIONS request.
 * Always returns 204 with CORS headers (empty Allow-Origin if disallowed).
 * This matches the original realtime-api behavior where preflight never fails.
 */
export function handleOptions(origin: string | null, patterns: CorsPattern[]): Response {
  const corsHeaders = getCorsHeaders(origin, patterns);
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Phase 7.4: Validate agent status at Worker level.
 * Returns error response if agent is suspended/disabled/not found,
 * or null to allow the request to proceed.
 *
 * @param agentId - Agent ID to validate (may be undefined/empty)
 * @param origin - Request origin for CORS headers
 * @param patterns - Parsed CORS patterns
 * @returns Error response if agent rejected, or null to allow through
 */
export async function validateAgentStatusForEdit(
  agentId: string | undefined,
  origin: string | null,
  patterns: CorsPattern[],
): Promise<Response | null> {
  // No agent ID - no validation needed
  if (agentId === undefined || agentId === '') {
    return null;
  }

  // Create agent context for status check
  const agentContext: AgentContext = { agentId };
  const result = await checkAgentStatus(agentContext);

  // Allowed - let request proceed
  if (result.allowed) {
    return null;
  }

  // Determine HTTP status based on denial reason
  let status: number;
  switch (result.reason) {
    case 'agent_not_found':
      status = 404;
      break;
    case 'agent_suspended':
    case 'agent_disabled':
      status = 403;
      break;
    case 'lookup_error':
    default:
      status = 500;
      break;
  }

  // Return error response with CORS headers
  return errorResponse(
    status,
    result.message ?? 'Agent access denied',
    origin,
    patterns,
  );
}

/**
 * Auth Phase 4: Context passed to realtime route handler.
 * Contains the authenticated principal for authorization and identity verification.
 */
export interface RealtimeRouteContext {
  principal: AuthenticatedPrincipal;
}

/**
 * Auth Phase 4: Determine required permission for a realtime action.
 * Read actions require canView, write actions require canEditDocuments.
 */
export function getRequiredPermission(action: RouteParams['action']): keyof RolePermissions {
  switch (action) {
    case 'edits':
    case 'agent-edit-start':
    case 'agent-edit-complete':
    case 'agent-edit-abort':
    case 'agent-stop':
    case 'can-agent-edit':
      return 'canEditDocuments';
    case 'connect':
    case 'focus-regions':
    default:
      return 'canView';
  }
}

// Re-export CorsPattern and isOriginAllowed for use by realtime-api.ts
export { type CorsPattern, isOriginAllowed };
