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
  BranchNotFoundError,
  SiteNotFoundError,
  AgentNotFoundError,
} from '../services/presence-rollup-service';
import { getMainBranch } from '../services/branch-service';
import { hasPermission } from '../auth/authorization';

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
class PresenceAuthorizationError extends Error {
  public readonly name = 'PresenceAuthorizationError';
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, PresenceAuthorizationError.prototype);
  }
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

  // Authorization check
  const hasAccess = await canViewBranch(context, context.siteId, context.branchId);
  if (!hasAccess) {
    throw new PresenceAuthorizationError(
      'Access denied: You do not have permission to view presence on this branch',
    );
  }

  const presence = await getBranchPresence(env, context.siteId, context.branchId);
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

  // Authorization check (same as branch-level — if you can view the branch, you can see document presence)
  const hasAccess = await canViewBranch(context, context.siteId, context.branchId);
  if (!hasAccess) {
    throw new PresenceAuthorizationError(
      'Access denied: You do not have permission to view presence on this document',
    );
  }

  const decodedPath = decodeURIComponent(context.documentPath);
  const presences = await queryDocumentPresence(env, context.siteId, decodedPath, context.branchId);

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
    // Handle authorization errors
    if (error instanceof PresenceAuthorizationError) {
      return errorResponse(error.message, 403);
    }

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

    // Log and return generic error for unknown errors
    console.error('Presence API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
