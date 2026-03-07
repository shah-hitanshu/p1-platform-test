/**
 * Service Principal Scope Enforcement
 *
 * Enforces that service principals (from site API tokens) are restricted to:
 * 1. Their bound siteId
 * 2. Operations allowed by their scopes
 *
 * Non-service principals (users, agents) pass through without restriction.
 */

import type { AuthenticatedPrincipal } from '../types';

export interface ServicePrincipalCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Scope-to-allowed-methods mapping.
 * Defines which HTTP methods each scope permits.
 */
const SCOPE_METHODS: Record<string, string[]> = {
  'read:published': ['GET'],
  'read:draft': ['GET'],
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
 */
export function isServicePrincipalAllowed(
  principal: AuthenticatedPrincipal,
  requestSiteId: string,
  method: string,
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

  // Scope enforcement: check method is allowed by at least one scope
  const scopes = principal.scopes ?? [];
  const allowedMethods = new Set<string>();
  for (const scope of scopes) {
    const methods = SCOPE_METHODS[scope];
    if (methods) {
      for (const m of methods) {
        allowedMethods.add(m);
      }
    }
  }

  if (!allowedMethods.has(method)) {
    return {
      allowed: false,
      reason: `Scopes [${scopes.join(', ')}] do not allow ${method} requests`,
    };
  }

  return { allowed: true };
}
