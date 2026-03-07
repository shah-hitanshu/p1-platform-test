/**
 * Site API Token Management Routes
 *
 * REST API endpoints for managing per-site API tokens.
 * All endpoints require admin permission (canManageGrants) on the site.
 * Service principals cannot manage tokens.
 *
 * POST   /api/sites/:siteId/tokens          - Generate new token
 * GET    /api/sites/:siteId/tokens          - List tokens
 * DELETE /api/sites/:siteId/tokens/:tokenId - Revoke token
 */

import type { AuthenticatedPrincipal } from '../types';
import {
  generateToken,
  listTokens,
  revokeToken,
} from '../services/site-api-token-service';
import { getMainBranch } from '../services';
import { assertPermission, AuthorizationError } from '../auth/authorization';

/**
 * Route context for token management endpoints
 */
export interface SiteTokenRouteContext {
  siteId?: string;
  tokenId?: string;
  principal: AuthenticatedPrincipal;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}

/**
 * Main route handler for site token operations
 */
export async function handleSiteTokenRoutes(
  request: Request,
  context: SiteTokenRouteContext,
): Promise<Response> {
  const { siteId, tokenId, principal } = context;
  const method = request.method;

  // Validate siteId
  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('Site ID is required', 400);
  }

  // Service principals cannot manage tokens
  if (principal.type === 'service') {
    return errorResponse('Service principals cannot manage API tokens', 403);
  }

  try {
    // Verify site exists
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    // Require admin permission on the site
    await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');

    // Route to handler
    if (tokenId !== undefined && tokenId !== '') {
      // Token-specific operations
      if (method === 'DELETE') {
        return await handleRevokeToken(siteId, tokenId);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Collection operations
    switch (method) {
      case 'POST':
        return await handleGenerateToken(request, siteId, principal);
      case 'GET':
        return await handleListTokens(siteId);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    console.error('Site Token API error:', error);
    return errorResponse('Internal server error', 500);
  }
}

interface GenerateTokenBody {
  name?: string;
  scopes?: string[];
}

async function handleGenerateToken(
  request: Request,
  siteId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body: unknown = await request.json();
  const { name, scopes } = body as GenerateTokenBody;

  if (name === undefined || name.trim() === '') {
    return errorResponse('name is required', 400);
  }

  const result = await generateToken({
    siteId,
    name,
    scopes,
    createdBy: principal.dbUserId ?? principal.id,
  });

  return jsonResponse(result, 201);
}

async function handleListTokens(siteId: string): Promise<Response> {
  const tokens = await listTokens(siteId);
  return jsonResponse({ tokens });
}

async function handleRevokeToken(
  siteId: string,
  tokenId: string,
): Promise<Response> {
  const revoked = await revokeToken(tokenId, siteId);

  if (!revoked) {
    return errorResponse('Token not found', 404);
  }

  return new Response(null, { status: 204 });
}
