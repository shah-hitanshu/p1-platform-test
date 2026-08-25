/**
 * Phase 8: Presence API Routes
 *
 * REST API endpoints for presence rollup operations.
 * Provides aggregated presence data across documents, branches, and sites.
 *
 * Endpoints:
 * - GET /api/sites/{siteId}/presence - Site-level presence
 * - GET /api/sites/{siteId}/branches/{branchId}/presence - Branch-level presence
 * - GET /api/organizations/{orgId}/agents/{agentId}/presence - Agent presence
 *
 * Authorization:
 * - Site/Branch presence: Requires canView permission on the site
 * - Agent presence: Requires caller to be in the same organization
 */

import type { AuthenticatedPrincipal } from '../types';
import {
  getBranchPresence,
  getSitePresence,
  getAgentPresence,
  queryDocumentPresence,
} from '../services/presence-rollup-service';
import { getBranch, getBranchByName, getMainBranch } from '../services/branch-service';
import { HttpError, BranchNotFoundError, SiteNotFoundError, AgentNotFoundError } from '../services/errors';
import { hasPermission } from '../auth/authorization';
import { UUID_RE } from '../utils/branch-ref';
import type { Branch } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal principal fields required for presence authorization.
 * Extends the core identity fields with optional authorization-related fields.
 * In production, a full AuthenticatedPrincipal is passed (from index.ts).
 * The optional fields accommodate callers and tests that pass partial objects.
 */
export interface PresencePrincipal {
  id: string;
  type: 'user' | 'agent';
  pantheonSiteRoles?: Record<string, string>;
  organizationId?: string;
  /** DB-generated users.id for authorization queries (set by principal enrichment) */
  dbUserId?: string;
  /** System role from DB (admin, member, etc.) */
  systemRole?: string;
  /** Token expiry for authorization checks */
  tokenExpiry?: string;
  /** Auth provider name */
  authProvider?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  providerSubjectId?: string;
}

/**
 * Request context for presence routes with authorization data
 */
export interface PresenceRouteContext {
  siteId?: string;
  branchId?: string;
  documentPath?: string;
  organizationId?: string;
  agentId?: string;
  principal: PresencePrincipal;
}

/**
 * Error thrown when authorization fails
 */
class PresenceAuthorizationError extends HttpError {
  readonly status = 403;
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * JSON response helper
 */
function jsonResponse(
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
 * Error response helper
 */
function errorResponse(
  error: string,
  status: number,
  details?: unknown,
): Response {
  return jsonResponse({ error, details }, status);
}

// =============================================================================
// Authorization Helpers
// =============================================================================

/**
 * Check if principal has access to view a site.
 * For site-level access, checks if the user has canView on the main branch.
 */
async function canViewSite(
  context: PresenceRouteContext,
  siteId: string,
): Promise<boolean> {
  // Quick check: if principal has a Pantheon role for this site, they have access
  if (context.principal.pantheonSiteRoles?.[siteId] !== undefined) {
    return true;
  }

  // Fallback: check canView permission on main branch
  const mainBranch = await getMainBranch(siteId);
  if (mainBranch === null) {
    return false;
  }

  return await hasPermission(
    context.principal as AuthenticatedPrincipal, siteId, mainBranch.id, 'canView',
  );
}

/**
 * PCC-3458: Resolve a branch ref (UUID or name) to the canonical branch,
 * verifying it belongs to the requested site. Presence lookups keyed by the
 * raw ref read the wrong side (~960 name-based presence requests/week were
 * silently answered as "nobody editing" while editors were active). Mirrors
 * the resolution in realtime-api.ts and content-api's resolveBranch.
 */
async function resolveBranchRef(
  siteId: string,
  branchRef: string,
): Promise<Branch | null> {
  const branch = UUID_RE.test(branchRef)
    ? await getBranch(branchRef)
    : await getBranchByName(siteId, branchRef);
  if (branch?.siteId !== siteId) {
    return null;
  }
  return branch;
}

/**
 * Check if principal has access to view a specific branch.
 */
async function canViewBranch(
  context: PresenceRouteContext,
  siteId: string,
  branchId: string,
): Promise<boolean> {
  // Quick check: if principal has a Pantheon role for this site, they have access
  if (context.principal.pantheonSiteRoles?.[siteId] !== undefined) {
    return true;
  }

  // Check canView permission on the specific branch
  return await hasPermission(
    context.principal as AuthenticatedPrincipal, siteId, branchId, 'canView',
  );
}

/**
 * Check if principal has access to view an organization's agent presence.
 * Requires the principal to be in the same organization.
 */
function canViewAgentPresence(
  context: PresenceRouteContext,
  organizationId: string,
): boolean {
  // Check if principal's organization matches the requested organization
  if (context.principal.organizationId === organizationId) {
    return true;
  }

  // For agents, they can only query their own organization
  if (context.principal.type === 'agent') {
    return context.principal.organizationId === organizationId;
  }

  // For users without organization, deny access
  // (In a full implementation, you might check if user has admin access)
  return false;
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/presence - Branch Presence
 */
async function handleGetBranchPresence(
  context: PresenceRouteContext,
  env: unknown,
): Promise<Response> {
  if (context.siteId === undefined || context.branchId === undefined) {
    return errorResponse('Site ID and Branch ID are required', 400);
  }

  // PCC-3458: resolve name-or-UUID ref to the canonical branch, then use the
  // UUID everywhere downstream so presence reads the side real sessions use.
  const branch = await resolveBranchRef(context.siteId, context.branchId);
  if (branch === null) {
    return errorResponse('Branch not found', 404);
  }

  // Authorization check
  const hasAccess = await canViewBranch(context, context.siteId, branch.id);
  if (!hasAccess) {
    throw new PresenceAuthorizationError(
      'Access denied: You do not have permission to view presence on this branch',
    );
  }

  const presence = await getBranchPresence(env, context.siteId, branch.id);
  return jsonResponse(presence);
}

/**
 * Handle GET /api/sites/{siteId}/presence - Site Presence
 */
async function handleGetSitePresence(
  context: PresenceRouteContext,
  env: unknown,
): Promise<Response> {
  if (context.siteId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  // Authorization check
  const hasAccess = await canViewSite(context, context.siteId);
  if (!hasAccess) {
    throw new PresenceAuthorizationError(
      'Access denied: You do not have permission to view presence on this site',
    );
  }

  const presence = await getSitePresence(env, context.siteId);
  return jsonResponse(presence);
}

/**
 * Handle GET /api/organizations/{orgId}/agents/{agentId}/presence - Agent Presence
 */
async function handleGetAgentPresence(
  context: PresenceRouteContext,
  env: unknown,
): Promise<Response> {
  if (context.organizationId === undefined || context.agentId === undefined) {
    return errorResponse('Organization ID and Agent ID are required', 400);
  }

  // Authorization check
  const hasAccess = canViewAgentPresence(context, context.organizationId);
  if (!hasAccess) {
    throw new PresenceAuthorizationError(
      'Access denied: You must be a member of the organization to view agent presence',
    );
  }

  const presence = await getAgentPresence(env, context.organizationId, context.agentId);
  return jsonResponse(presence);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/presence
 */
async function handleGetDocumentPresence(
  context: PresenceRouteContext,
  env: unknown,
): Promise<Response> {
  if (context.siteId === undefined || context.branchId === undefined || context.documentPath === undefined) {
    return errorResponse('Site ID, Branch ID, and Document Path are required', 400);
  }

  // PCC-3458: resolve name-or-UUID ref to the canonical branch (see
  // resolveBranchRef) and use the UUID for auth + presence lookups.
  const docBranch = await resolveBranchRef(context.siteId, context.branchId);
  if (docBranch === null) {
    return errorResponse('Branch not found', 404);
  }

  // Authorization check (same as branch-level — if you can view the branch, you can see document presence)
  const hasAccess = await canViewBranch(context, context.siteId, docBranch.id);
  if (!hasAccess) {
    throw new PresenceAuthorizationError(
      'Access denied: You do not have permission to view presence on this document',
    );
  }

  const decodedPath = decodeURIComponent(context.documentPath);
  const presences = await queryDocumentPresence(env, context.siteId, decodedPath, docBranch.id);

  return jsonResponse({ presences });
}

// =============================================================================
// Main Route Handler
// =============================================================================

/**
 * Main route handler for presence operations
 */
export async function handlePresenceRoutes(
  request: Request,
  context: PresenceRouteContext,
  env: unknown,
): Promise<Response> {
  const method = request.method;

  // Only GET requests are allowed for presence endpoints
  if (method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    // Determine which endpoint to handle based on context
    if (context.organizationId !== undefined && context.agentId !== undefined) {
      // Agent presence endpoint
      return await handleGetAgentPresence(context, env);
    }

    if (context.siteId !== undefined && context.branchId !== undefined && context.documentPath !== undefined) {
      // Document presence endpoint
      return await handleGetDocumentPresence(context, env);
    }

    if (context.siteId !== undefined && context.branchId !== undefined) {
      // Branch presence endpoint
      return await handleGetBranchPresence(context, env);
    }

    if (context.siteId !== undefined) {
      // Site presence endpoint
      return await handleGetSitePresence(context, env);
    }

    // No valid endpoint found
    return errorResponse('Invalid presence endpoint', 400);
  } catch (error) {
    // Handle known errors
    if (error instanceof BranchNotFoundError) {
      return errorResponse(`Branch "${error.branchId}" not found`, 404);
    }
    if (error instanceof SiteNotFoundError) {
      return errorResponse(`Site "${error.siteId}" not found`, 404);
    }
    if (error instanceof AgentNotFoundError) {
      return errorResponse(`Agent "${error.agentId}" not found`, 404);
    }
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status);
    }

    // Log and return generic error for unknown errors
    console.error('Presence API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
