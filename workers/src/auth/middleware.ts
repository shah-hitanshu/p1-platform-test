/**
 * Phase 2.2: Authorization System - Permission Middleware
 *
 * Express-style middleware for enforcing permissions on routes.
 * Handles permission checking, guest access, and error responses.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Permission Middleware"
 */

import type { AuthenticatedPrincipal, RoleName, RolePermissions } from '../types';
import { getEffectiveRole } from './authorization';
import { roleAtLeast } from './roles';

/**
 * Request object with principal and authorization context.
 */
export interface AuthorizedRequest {
  principal?: AuthenticatedPrincipal & { type: 'user' | 'agent' | 'service' | 'guest' };
  params: Record<string, string>;
  effectiveRole?: RolePermissions;
  effectiveRoleName?: RoleName;
}

/**
 * Response object for middleware.
 */
export interface MiddlewareResponse {
  status(code: number): MiddlewareResponse;
  json(body: unknown): MiddlewareResponse;
}

/**
 * Next function for middleware chain.
 */
export type NextFunction = (error?: Error) => void;

/**
 * Middleware function type.
 */
export type Middleware = (
  req: AuthorizedRequest,
  res: MiddlewareResponse,
  next: NextFunction
) => Promise<void>;

/**
 * Creates middleware that requires a specific permission to access the route.
 *
 * The middleware:
 * 1. Validates that the request has an authenticated principal
 * 2. Validates that siteId and branchId are present in params
 * 3. Special-cases guest principals (only canView allowed)
 * 4. Calculates effective role and checks permission
 * 5. Attaches effectiveRole and effectiveRoleName to request
 *
 * @param permission - The permission required to access the route
 * @returns Express-style middleware function
 *
 * @example
 * ```typescript
 * router.get('/branches/:branchId',
 *   requireAuth(),
 *   requirePermission('canView'),
 *   getBranchHandler
 * );
 * ```
 */
export function requirePermission(permission: keyof RolePermissions): Middleware {
  return async (req, res, next) => {
    try {
      // Check for authenticated principal
      if (!req.principal) {
        res.status(401).json({
          error: 'Authentication required',
        });
        return;
      }

      const { siteId, branchId } = req.params;

      // Validate route parameters
      if (siteId === undefined || siteId === '') {
        res.status(400).json({
          error: 'Missing required parameter: siteId',
        });
        return;
      }

      if (branchId === undefined || branchId === '') {
        res.status(400).json({
          error: 'Missing required parameter: branchId',
        });
        return;
      }

      // Special case: guests have fixed VIEWER role
      if (req.principal.type === 'guest') {
        if (permission !== 'canView') {
          res.status(403).json({
            error: 'Guests can only view',
          });
          return;
        }
        // Guests pass canView check
        next();
        return;
      }

      // Calculate effective role
      const { role, roleName } = await getEffectiveRole(
        req.principal,
        siteId,
        branchId,
      );

      // Check permission
      if (!role[permission]) {
        res.status(403).json({
          error: `Missing permission: ${permission}`,
          required: permission,
          yourRole: roleName,
        });
        return;
      }

      // Attach role info to request for downstream handlers
      req.effectiveRole = role;
      req.effectiveRoleName = roleName;

      next();
    } catch (error) {
      // Pass errors to error handling middleware
      next(error as Error);
    }
  };
}

/**
 * Creates middleware that requires a minimum role level.
 *
 * This is an alternative to requirePermission when you want to check
 * the role level rather than a specific permission.
 *
 * @param minRole - The minimum role required (EDITOR or ADMIN)
 * @returns Express-style middleware function
 *
 * @example
 * ```typescript
 * router.post('/admin/settings',
 *   requireAuth(),
 *   requireRole('ADMIN'),
 *   updateSettingsHandler
 * );
 * ```
 */
export function requireRole(minRole: 'VIEWER' | 'EDITOR' | 'ADMIN'): Middleware {
  return async (req, res, next) => {
    try {
      // Check for authenticated principal
      if (!req.principal) {
        res.status(401).json({
          error: 'Authentication required',
        });
        return;
      }

      const { siteId, branchId } = req.params;

      // Validate route parameters
      if (siteId === undefined || siteId === '') {
        res.status(400).json({
          error: 'Missing required parameter: siteId',
        });
        return;
      }

      if (branchId === undefined || branchId === '') {
        res.status(400).json({
          error: 'Missing required parameter: branchId',
        });
        return;
      }

      // Special case: guests have fixed VIEWER role
      if (req.principal.type === 'guest') {
        if (minRole !== 'VIEWER') {
          res.status(403).json({
            error: 'Guests can only view',
            required: minRole,
            yourRole: 'VIEWER',
          });
          return;
        }
        next();
        return;
      }

      // Calculate effective role
      const { role, roleName } = await getEffectiveRole(
        req.principal,
        siteId,
        branchId,
      );

      // Check role level
      if (!roleAtLeast(roleName, minRole as 'EDITOR' | 'ADMIN')) {
        res.status(403).json({
          error: `Insufficient role: requires ${minRole}`,
          required: minRole,
          yourRole: roleName,
        });
        return;
      }

      // Attach role info to request
      req.effectiveRole = role;
      req.effectiveRoleName = roleName;

      next();
    } catch (error) {
      next(error as Error);
    }
  };
}
