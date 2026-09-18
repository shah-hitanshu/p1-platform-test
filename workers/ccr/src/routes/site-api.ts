/**
 * Phase 7.1.1b: Site API Routes
 *
 * REST API endpoints for site operations.
 * Includes deletion protection for sites with non-archived branches.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { WorkflowSettings, AuthenticatedPrincipal, Branch } from '../types';
import {
  createSite,
  getSite,
  updateSite,
  archiveSite,
  restoreSite,
  listSites,
  listBranches,
  getMainBranch,
  getOrganizationsForUser,
  getUserOwnedOrg,
  linkSiteToOrganization,
  DuplicatePantheonSiteIdError,
  HttpError,
  getSiteOwner,
} from '../services';
import { assertPermission, getEffectiveRole, getSiteRole } from '../auth/authorization';
import { ROLES } from '../auth/roles';
import type { MASClient } from '../services/mas-client';
import { canAccessOrganization, isOrgAdmin } from '../utils/org-access';
import { isSuperAdmin } from '../utils/admin-check';
import type { ScreenshotProducerEnv } from '../queues/screenshot-producer';
import { and, eq } from 'drizzle-orm';
import { organizationMembers, users } from '../db/schema';
import { db } from '../db/scope';
import { grantRole as grantUserSiteRole } from '../services/user-site-role-service';
import { validatePagination, validateAllowedOriginPatterns } from './validation';

/**
 * Request context for site routes
 */
export interface SiteRouteContext {
  siteId?: string;
  action?: string;
  principal: AuthenticatedPrincipal;
  masClient?: MASClient;
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

/**
 * Request body for creating a site
 */
interface CreateSiteBody {
  pantheonSiteId?: string;
  name?: string;
  url?: string;
  workflowSettings?: Partial<WorkflowSettings>;
  allowedOrigins?: string[];
  organizationId?: string;
}

/**
 * Request body for updating a site
 */
interface UpdateSiteBody {
  name?: string;
  url?: string | null;
  pantheonSiteId?: string | null;
  workflowSettings?: Partial<WorkflowSettings>;
  allowedOrigins?: string[];
}

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

/**
 * Handle POST /api/sites - Create Site
 *
 * Creates a new site and automatically creates the main branch.
 * The main branch represents the production state of the site.
 *
 * Restricted to user principals. An agent-created site is granted only to the
 * agent, and both listSites and getEffectiveRole intersect an agent's access
 * with its acting user's roles, so such a site is invisible to the agent's own
 * listing and unusable by every branch and document operation. A person creates
 * the site through their own authenticated session instead.
 */
async function handleCreateSite(
  request: Request,
  context: SiteRouteContext,
  env: ScreenshotProducerEnv | undefined,
): Promise<Response> {
  if (context.principal.type !== 'user') {
    return errorResponse(
      'Site creation requires an authenticated user session. An agent API key cannot create sites; connect as a user and retry.',
      403,
    );
  }

  const body = await parseJsonBody<CreateSiteBody>(request);

  // Creating a site is organization administration: an owner or admin of an
  // active organization may do it, a plain member may not. When a specific
  // org is requested, verify admin rights in that org rather than any org.
  if (!(await isSuperAdmin(context.principal))) {
    const permitted = body.organizationId !== undefined
      ? await isOrgAdmin(context.principal, body.organizationId)
      : (await getOrganizationsForUser(
        context.principal.dbUserId ?? context.principal.id,
      )).some((m) => m.role === 'owner' || m.role === 'admin');
    if (!permitted) {
      return errorResponse(
        'Creating a site requires an admin or owner role in your organization.',
        403,
      );
    }
  }

  if (body.name === undefined || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }

  // PCC-3531: nothing is stored yet, so every entry is new and gets validated.
  if (body.allowedOrigins !== undefined) {
    const originsError = validateAllowedOriginPatterns(body.allowedOrigins);
    if (originsError !== undefined) {
      return errorResponse(originsError, 400);
    }
  }

  const site = await createSite(
    {
      pantheonSiteId: body.pantheonSiteId,
      name: body.name,
      url: body.url,
      workflowSettings: body.workflowSettings,
      allowedOrigins: body.allowedOrigins,
      creatorId: context.principal.dbUserId ?? context.principal.id,
      createdByType: context.principal.type,
    },
    env,
  );

  if (context.principal.dbUserId !== undefined) {
    const creatorId = context.principal.dbUserId;
    try {
      const orgId = body.organizationId ?? await getUserOwnedOrg(creatorId);
      if (orgId !== null) {
        await linkSiteToOrganization(site.id, orgId);

        // When the site lands in an org the creator doesn't own, grant each
        // active org owner admin access so they can manage their own org's site.
        const owners = await db()
          .select({ userId: organizationMembers.userId })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, orgId),
              eq(organizationMembers.role, 'owner'),
              eq(organizationMembers.isActive, true),
            ),
          );
        await Promise.all(
          owners
            .filter(({ userId }) => userId !== creatorId)
            .map(({ userId }) =>
              grantUserSiteRole({ userId, siteId: site.id, role: 'admin', grantedBy: creatorId }),
            ),
        );
      }
    } catch (orgError) {
      getLogger().error('Auto-assign org failed for site', orgError, { site_id: site.id });
    }
  }

  getLogger().info('site created', {
    site_id: site.id,
    principal_type: context.principal.type,
    principal_id: context.principal.dbUserId ?? context.principal.id,
    outcome: 'ok',
  });

  return jsonResponse(site, 201);
}

/**
 * Handle GET /api/sites - List Sites
 */
async function handleListSites(
  request: Request,
  context: SiteRouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const archivedParam = url.searchParams.get('archived');
  const archived = archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined;
  const organizationId = url.searchParams.get('organizationId') ?? undefined;

  // Validate pagination parameters
  const pagination = validatePagination(limitParam, offsetParam);
  if (!pagination.valid) {
    return errorResponse(pagination.error ?? 'Invalid pagination parameters', 400);
  }

  // PCC-3190: when an agent acts on behalf of a user, restrict the listing
  // to sites the acting user also has a role on. The MCP-server-forwarded
  // X-Acting-User-Email is trusted only when principal.type === 'agent'
  // (see extractActingUser). If the acting user is unknown to app.users
  // we return an empty list rather than running the agent's full query.
  let actingUserId: string | undefined;
  if (
    context.principal.type === 'agent'
    && context.principal.actingUserEmail !== undefined
    && context.principal.actingUserEmail !== ''
  ) {
    const actingUserRows = await db()
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.email, context.principal.actingUserEmail.toLowerCase()),
          eq(users.isActive, true),
        ),
      );
    const actingUserRow = actingUserRows[0];
    if (actingUserRow === undefined) {
      return jsonResponse({ sites: [] });
    }
    actingUserId = actingUserRow.id;
  }

  // A superadmin reaches every organization, so the listing must widen with the
  // gate: passing the org check but still filtering by the caller's own site
  // roles returns an empty list for an account they can administer.
  //
  // isSuperAdmin is checked first so we skip canAccessOrganization for
  // superadmins (it would return true anyway) and avoid calling isSuperAdmin
  // twice — canAccessOrganization also calls it internally.
  let includeAllOrgSites = false;
  if (organizationId !== undefined) {
    includeAllOrgSites = await isSuperAdmin(context.principal);
    if (!includeAllOrgSites && !(await canAccessOrganization(context.principal, organizationId))) {
      return errorResponse('Access denied to the specified organization', 403);
    }
  }

  const sites = await listSites({
    limit: pagination.limit,
    offset: pagination.offset,
    principalId: context.principal.dbUserId ?? context.principal.id,
    principalType: context.principal.type as 'user' | 'agent',
    actingUserId,
    archived,
    organizationId,
    includeAllOrgSites,
  });

  return jsonResponse({ sites });
}

/**
 * Handle GET /api/sites/{siteId} - Get Site
 */
async function handleGetSite(context: SiteRouteContext, mainBranch: Branch): Promise<Response> {
  if (context.siteId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  const site = await getSite(context.siteId);

  if (site === null) {
    return errorResponse('Site not found', 404);
  }

  // The dashboard gates its controls on the permissions returned here, so the
  // role has to be the one the write routes enforce with, not the baseline
  // grant alone. Service principals sit outside the role system and keep the
  // baseline lookup.
  const [role, owner] = await Promise.all([
    context.principal.type === 'service'
      ? getSiteRole(context.principal, context.siteId, context.masClient)
      : getEffectiveRole(context.principal, context.siteId, mainBranch.id, context.masClient)
        .then((r) => r.roleName),
    getSiteOwner(context.siteId),
  ]);

  return jsonResponse({
    ...site,
    role,
    permissions: ROLES[role],
    ownerName: owner?.name ?? null,
    ownerAvatarUrl: owner?.avatarUrl ?? null,
  });
}

/**
 * Handle PATCH /api/sites/{siteId} - Update Site
 */
async function handleUpdateSite(
  request: Request,
  context: SiteRouteContext,
  env: ScreenshotProducerEnv | undefined,
): Promise<Response> {
  if (context.siteId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  const body = await parseJsonBody<UpdateSiteBody>(request);

  // updateSite writes name through COALESCE($1, name), which treats '' as a
  // value rather than "leave alone" — unlike url and pantheonSiteId, which
  // carry an explicit provided flag. A blank name is invalid input, not an
  // instruction to clear, and handleCreateSite already rejects it.
  if (body.name?.trim() === '') {
    return errorResponse('name cannot be empty', 400);
  }

  // PCC-3531: validate only origins that are not already stored. Read the row
  // directly rather than through getCachedSiteAllowedOrigins — a stale cache
  // could classify a recently-added origin as new and reject a resend of it.
  if (body.allowedOrigins !== undefined) {
    // A null row is not treated as a 404 here — the dispatcher already resolved
    // the site's main branch to get this far. It falls through as "nothing
    // stored", which validates every entry: stricter, never more permissive.
    const existingSite = await getSite(context.siteId);

    const originsError = validateAllowedOriginPatterns(
      body.allowedOrigins,
      existingSite?.allowedOrigins,
    );
    if (originsError !== undefined) {
      return errorResponse(originsError, 400);
    }
  }

  const params: Parameters<typeof updateSite>[1] = {
    name: body.name,
    workflowSettings: body.workflowSettings,
    allowedOrigins: body.allowedOrigins,
  };
  // Preserve key presence for clearable fields: only set when the request
  // contained them, so the service can distinguish "leave as-is" (omitted)
  // from "clear" (null).
  if ('url' in body) {
    params.url = body.url;
  }
  if ('pantheonSiteId' in body) {
    params.pantheonSiteId = body.pantheonSiteId;
  }

  const updatedSite = await updateSite(context.siteId, params, env);

  if (updatedSite === null) {
    return errorResponse('Site not found', 404);
  }

  return jsonResponse(updatedSite);
}

/**
 * Handle DELETE /api/sites/{siteId} - Archive Site (soft delete)
 *
 * Soft-deletes the site by setting archived_at. Cascades to branches and documents.
 * Returns 409 if non-main, non-archived branches exist.
 */
async function handleDeleteSite(context: SiteRouteContext): Promise<Response> {
  if (context.siteId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  // Check for non-archived, non-main branches
  const branches = await listBranches(context.siteId);
  const nonArchivedNonMainBranches = branches.filter(
    (b) => b.status !== 'archived' && b.status !== 'merged' && !b.isMain,
  );

  if (nonArchivedNonMainBranches.length > 0) {
    return errorResponse(
      'Cannot delete site with active non-main branches. Archive or delete all non-main branches first.',
      409,
      { branchCount: nonArchivedNonMainBranches.length },
    );
  }

  const result = await archiveSite(context.siteId);

  if (result === false) {
    return errorResponse('Site not found', 404);
  }
  if (result === 'already_archived') {
    return errorResponse('Site is already archived', 409);
  }

  return new Response(null, { status: 204 });
}

/**
 * Handle POST /api/sites/{siteId}/restore - Restore archived site
 */
async function handleRestoreSite(context: SiteRouteContext): Promise<Response> {
  if (context.siteId === undefined) {
    return errorResponse('Site ID is required', 400);
  }

  const site = await restoreSite(context.siteId);

  if (site === null) {
    return errorResponse('Site not found or not archived', 404);
  }

  return new Response(JSON.stringify(site), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Main route handler for site operations
 */
export async function handleSiteRoutes(
  request: Request,
  context: SiteRouteContext,
  env?: ScreenshotProducerEnv,
): Promise<Response> {
  const method = request.method;

  try {
    // Routes with siteId (single site operations)
    if (context.siteId !== undefined) {
      const mainBranch = await getMainBranch(context.siteId);

      // POST /api/sites/:siteId/restore — site is archived so mainBranch may still resolve;
      // we require canManageGrants and accept a missing mainBranch as a 404.
      if (method === 'POST' && context.action === 'restore') {
        if (mainBranch === null) {
          return errorResponse('Site not found', 404);
        }
        await assertPermission(context.principal, context.siteId, mainBranch.id, 'canManageGrants');
        return await handleRestoreSite(context);
      }

      if (mainBranch === null) {
        return errorResponse('Site not found', 404);
      }

      switch (method) {
        case 'GET':
          await assertPermission(context.principal, context.siteId, mainBranch.id, 'canView');
          return await handleGetSite(context, mainBranch);
        case 'PATCH':
          await assertPermission(context.principal, context.siteId, mainBranch.id, 'canManageGrants');
          return await handleUpdateSite(request, context, env);
        case 'DELETE':
          await assertPermission(context.principal, context.siteId, mainBranch.id, 'canManageGrants');
          return await handleDeleteSite(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without siteId (collection operations)
    switch (method) {
      case 'GET':
        return await handleListSites(request, context);
      case 'POST':
        return await handleCreateSite(request, context, env);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof DuplicatePantheonSiteIdError) {
      return errorResponse('A site with this Pantheon site ID already exists', 409);
    }

    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status);
    }

    // Log and return generic error for unknown errors
    console.error('Site API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
