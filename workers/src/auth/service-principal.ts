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
 * Scope rules mapping. Each scope maps to a list of independent rule clauses
 * (OR'd together) rather than one flat {methods, allowedHandlers} pair, so a
 * scope needing two unrelated operations (e.g. POST on one handler, GET on
 * another) can't accidentally cross-product into methods/handlers it was
 * never meant to authorize (e.g. GET on the first handler, or POST on the
 * second). Most scopes only need one clause; write:registry needs two.
 */
export const SCOPE_RULES: Record<string, ScopeRule[]> = {
  'read:published': [
    {
      methods: ['GET'],
      allowedHandlers: ['content'],
      mainBranchOnly: true,
    },
  ],
  'read:all': [
    {
      methods: ['GET'],
      allowedHandlers: ['content', 'documents', 'branches', 'site-export'],
      mainBranchOnly: false,
    },
  ],
  'read:draft': [
    {
      methods: ['GET'],
      allowedHandlers: ['content', 'documents', 'branches'],
      mainBranchOnly: false,
    },
  ],
  // Allows the site import endpoint (POST) and site export endpoint (GET).
  // Intentionally narrow — does not grant access to content, branch, grant,
  // checkpoint, or merge handlers. Use read:all for general read access.
  'write:create': [
    {
      methods: ['GET', 'POST'],
      allowedHandlers: ['site-import', 'site-export'],
      mainBranchOnly: false,
    },
  ],
  'write:registry': [
    // Coarse gate only — narrowly restricted to _registry/components/ (and
    // the registry index) by a path-aware, deny-by-default guard in
    // document-api.ts, since this clause alone can't express "one operation
    // on one path prefix" (it would otherwise also authorize publish,
    // site-scoped restore, and site-scoped create, which POST + 'documents'
    // also routes through).
    {
      methods: ['POST'],
      allowedHandlers: ['documents'],
      mainBranchOnly: false,
    },
    // A second, independent clause so the CI sync script can list branches
    // (to match the pushed git branch's name to a CSS branch) without this
    // GET grant also legalizing GET+documents or POST+branches as a
    // cross-product side effect. Narrowed to the list operation only by a
    // deny-by-default guard in branch-api.ts (denies single-branch fetch,
    // create, and restore, which also route through GET/POST + 'branches').
    {
      methods: ['GET'],
      allowedHandlers: ['branches'],
      mainBranchOnly: false,
    },
  ],
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
    const rules = SCOPE_RULES[scope];
    if (!rules) {
      continue;
    }

    for (const rule of rules) {
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

      // This clause allows the operation
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: 'Insufficient scope for this operation',
  };
}
