/**
 * Service Principal Scope Enforcement
 *
 * Enforces that service principals (from site API tokens) are restricted to:
 * 1. Their bound siteId
 * 2. Operations allowed by their scopes (method, handler, branch constraints)
 *
 * Non-service principals (users, agents) pass through without restriction.
 */

import type { AuthenticatedPrincipal } from '../types';

export interface ServicePrincipalCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Defines the constraints for a single scope.
 */
export interface ScopeRule {
  methods: string[];
  allowedHandlers: string[] | '*';
  mainBranchOnly?: boolean;
}

/**
 * Scope rules mapping.
 * Defines which HTTP methods, route handlers, and branch constraints each scope permits.
 */
export const SCOPE_RULES: Record<string, ScopeRule> = {
  'read:published': {
    methods: ['GET'],
    allowedHandlers: ['content'],
    mainBranchOnly: true,
  },
  'read:all': {
    methods: ['GET'],
    allowedHandlers: ['content', 'documents', 'branches', 'site-export'],
    mainBranchOnly: false,
  },
  'read:draft': {
    methods: ['GET'],
    allowedHandlers: ['content', 'documents', 'branches'],
    mainBranchOnly: false,
  },
  // Allows the site import endpoint (POST) and site export endpoint (GET).
  // Intentionally narrow — does not grant access to content, branch, grant,
  // checkpoint, or merge handlers. Use read:all for general read access.
  'write:create': {
    methods: ['GET', 'POST'],
    allowedHandlers: ['site-import', 'site-export'],
    mainBranchOnly: false,
  },
};

/**
 * Check if a service principal is allowed to perform the requested operation.
 *
 * Non-service principals always pass through (enforcement is handled
 * by the existing authorization system for users and agents).
 *
 * @param principal - The authenticated principal
 * @param requestSiteId - The site ID from the request path
 * @param method - The HTTP method
 * @param routeHandler - The route handler name (defaults to 'content' for backward compatibility)
 * @param branchIsMain - Whether the target branch is main (undefined treated as main for backward compatibility)
 */
export function isServicePrincipalAllowed(
  principal: AuthenticatedPrincipal,
  requestSiteId: string,
  method: string,
  routeHandler = 'content',
  branchIsMain?: boolean,
): ServicePrincipalCheck {
  // Only enforce for service principals
  if (principal.type !== 'service') {
    return { allowed: true };
  }

  // Service principals must have a siteId
  if (principal.siteId === undefined || principal.siteId === '') {
    return { allowed: false, reason: 'Service principal has no bound site' };
  }

  // Site scoping: principal can only access its bound site
  if (principal.siteId !== requestSiteId) {
    return {
      allowed: false,
      reason: `Service principal is bound to site ${principal.siteId}, cannot access site ${requestSiteId}`,
    };
  }

  // Scope enforcement: check if ANY scope allows the operation
  const scopes = principal.scopes ?? [];
  const effectiveBranchIsMain = branchIsMain ?? true;

  for (const scope of scopes) {
    const rule = SCOPE_RULES[scope];
    if (!rule) {
      continue;
    }

    // Check method
    if (!rule.methods.includes(method)) {
      continue;
    }

    // Check handler
    if (rule.allowedHandlers !== '*' && !rule.allowedHandlers.includes(routeHandler)) {
      continue;
    }

    // Check branch constraint
    if (rule.mainBranchOnly === true && !effectiveBranchIsMain) {
      continue;
    }

    // This scope allows the operation
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'Insufficient scope for this operation',
  };
}
