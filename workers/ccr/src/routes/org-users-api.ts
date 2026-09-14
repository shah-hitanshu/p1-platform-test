/**
 * Organization Users API Routes
 *
 * REST endpoints for the people who belong to one business account:
 *   GET    /api/organizations/{orgId}/users
 *   POST   /api/organizations/{orgId}/users
 *   PATCH  /api/organizations/{orgId}/users/{userId}
 *   DELETE /api/organizations/{orgId}/users/{userId}
 *
 * These replace the global /api/admin/users listing for the dashboard: users
 * are scoped to the organization the caller currently has selected, never to
 * the whole platform. Superadmins are no exception — their extra power is that
 * every organization is selectable, not that every user is listed at once.
 *
 * Every route here needs two things of the caller: access to the organization
 * (canAccessOrganization) and the admin role *within it* (isOrgAdmin). A plain
 * member of a business account cannot so much as list its people.
 *
 * The role this API assigns is organization_members.role — scoped to this
 * account. It deliberately never touches app.users.system_role: that is the
 * platform-wide role, and letting an account's own admin hand it out would make
 * every business account a route to platform administration.
 *
 * Adding a user here joins them to *this* organization. That is the difference
 * that makes PCC-3479's "invited user shouldn't be pushed through business
 * account setup" work: the invitee lands in the inviter's org instead of
 * getting an org of their own minted for them.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal } from '../types';
import type { OrganizationRole } from '../services';
import { eq, sql } from 'drizzle-orm';
import { users } from '../db/schema';
import { db } from '../db/scope';
import {
  getUsersForOrganization,
  addUserToOrganization,
  removeUserFromOrganization,
  countOrganizationAdmins,
  countOrganizationMembers,
  getOrganizationRole,
  updateOrganizationMember,
  isOrganizationMemberActive,
  isUserInOrganization,
  getOrganizationById,
  recordAuditEntry,
  OrganizationNotFoundError,
} from '../services';
import { isOrgAdmin, resolveUserId } from '../utils/org-access';

/**
 * Request context for organization user routes
 */
export interface OrgUsersRouteContext {
  organizationId: string;
  userId?: string;
  principal: AuthenticatedPrincipal;
}

/**
 * Roles assignable through this API, scoped to the organization in the path.
 *
 * `owner` is deliberately absent. Handing out "this account belongs to you" is
 * an ownership transfer — its own operation, with its own audit entry — not a
 * roster edit. The guards below stop an owner being moved out of the role,
 * removed, or deactivated through this API at all, with no head-count
 * exception: ownership only ever changes through that dedicated transfer.
 */
const ASSIGNABLE_ORG_ROLES: OrganizationRole[] = ['member', 'admin'];

function isAssignableOrgRole(role: string): role is OrganizationRole {
  return (ASSIGNABLE_ORG_ROLES as string[]).includes(role);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status: number, details?: unknown): Response {
  return jsonResponse({ error, details }, status);
}

/** Returns undefined for an unparseable body, which is a 400 rather than a 500. */
async function parseJsonBody<T>(request: Request): Promise<T | undefined> {
  try {
    return await request.json<T>();
  } catch {
    return undefined;
  }
}

interface AddOrgUserBody {
  email?: string;
  name?: string;
  role?: string;
}

interface UpdateOrgUserBody {
  name?: string;
  role?: string;
  isActive?: boolean;
}

type UserRow = Pick<
  typeof users.$inferSelect,
  'id' | 'email' | 'name' | 'principalId' | 'authProvider' | 'systemRole' | 'isActive' | 'createdAt' | 'updatedAt'
>;

const USER_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  principalId: users.principalId,
  authProvider: users.authProvider,
  systemRole: users.systemRole,
  isActive: users.isActive,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

/**
 * A typo here mints an app.users row nothing in this API can delete again.
 * Domain labels exclude the dot so each one matches in exactly one way — an
 * overlapping class makes a long bad address backtrack for far too long.
 */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/;

/**
 * Whether this request is an admin editing their own membership (PCC-3479).
 *
 * Refused on both PATCH and DELETE. The last-admin guards below only stop the
 * final admin from stepping down; with two admins either could still demote,
 * deactivate or remove themselves, and an account can be whittled down to
 * nobody one self-inflicted request at a time. Changing your own access is
 * another admin's job. A superadmin has no dbUserId collision to worry about —
 * they are only ever themselves here too.
 *
 * Compared case-insensitively: the id comes back lowercase from Postgres but
 * context.userId is a raw path segment, and every query downstream casts it
 * `::uuid`, where equality ignores case. A plain string compare therefore lets
 * `PATCH .../users/{UPPERCASE-UUID}` walk past this guard and land on the same
 * row.
 *
 * Resolved the same way the org checks resolve it: the request gate sets no
 * dbUserId where there is no real auth provider, and the guard must still hold.
 */
async function isSelfEdit(context: OrgUsersRouteContext): Promise<boolean> {
  const selfUserId = await resolveUserId(context.principal);
  return (
    selfUserId !== undefined
    && selfUserId.toLowerCase() === context.userId?.toLowerCase()
  );
}

/**
 * Both roles go out on the wire: `role` is this user's role in the organization
 * being viewed and is what the dashboard edits; `systemRole` is their
 * platform-wide role, read-only here, and is only interesting so the UI can
 * mark Pantheon staff.
 */
function serializeUser(
  row: UserRow,
  role: OrganizationRole,
  isDirectMember: boolean,
  isActive: boolean,
): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    principalId: row.principalId,
    authProvider: row.authProvider,
    role,
    systemRole: row.systemRole,
    isActive,
    isDirectMember,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Handle GET /api/organizations/{orgId}/users
 */
async function handleListOrgUsers(context: OrgUsersRouteContext): Promise<Response> {
  const users = await getUsersForOrganization(context.organizationId);
  return jsonResponse({ users });
}

/**
 * Handle POST /api/organizations/{orgId}/users — add a user to this org.
 *
 * Creates the app.users row when the email is new to P1; principal_id stays
 * NULL until the invitee first signs in (the request gate links it then). The
 * new row's system_role is left at the 'member' default — the role in the body
 * is the one inside this organization.
 */
async function handleAddOrgUser(
  request: Request,
  context: OrgUsersRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<AddOrgUserBody>(request);
  if (body === undefined) {
    return errorResponse('Invalid JSON body', 400);
  }

  const trimmedEmail = body.email?.trim() ?? '';
  const role = body.role ?? 'member';

  if (trimmedEmail === '') {
    return errorResponse('email is required', 400);
  }
  if (!EMAIL_PATTERN.test(trimmedEmail)) {
    return errorResponse('Invalid email address', 400);
  }
  if (!isAssignableOrgRole(role)) {
    return errorResponse(
      `Invalid role. Must be one of: ${ASSIGNABLE_ORG_ROLES.join(', ')}`,
      400,
    );
  }
  const organization = await getOrganizationById(context.organizationId);
  if (organization === null) {
    return errorResponse('Organization not found', 404);
  }

  const email = trimmedEmail.toLowerCase();
  const name = body.name?.trim();

  // Reuse the existing row when the email is already known to P1 — a user can
  // belong to more than one organization, and re-inviting must not 409 on the
  // app.users unique index.
  const inserted = await db()
    .insert(users)
    .values({ email, name: name ?? null })
    .onConflictDoNothing({ target: users.email })
    .returning(USER_COLUMNS);

  let userRow = inserted[0];
  if (userRow === undefined) {
    const existing = await db().select(USER_COLUMNS).from(users).where(eq(users.email, email));
    userRow = existing[0];
    if (userRow === undefined) {
      return errorResponse('Failed to add user', 500);
    }

    if (await isUserInOrganization(userRow.id, context.organizationId)) {
      return errorResponse('This user is already in the organization', 409);
    }

    // Fill in a name we were given for a user who never supplied one.
    if (name !== undefined && name !== '' && userRow.name === null) {
      const updated = await db()
        .update(users)
        .set({ name, updatedAt: sql`NOW()` })
        .where(eq(users.id, userRow.id))
        .returning(USER_COLUMNS);
      userRow = updated[0] ?? userRow;
    }
  }

  let added: boolean;
  try {
    added = await addUserToOrganization(context.organizationId, userRow.id, role);
  } catch (error) {
    if (error instanceof OrganizationNotFoundError) {
      return errorResponse('Organization not found', 404);
    }
    throw error;
  }

  if (!added) {
    // A concurrent request won the race and added the user between our
    // isUserInOrganization check and this insert.
    if (await isUserInOrganization(userRow.id, context.organizationId)) {
      return errorResponse('This user is already in the organization', 409);
    }
    return errorResponse('Failed to add user', 500);
  }

  await recordAuditEntry({
    action: 'org_user.add',
    actor: context.principal,
    organizationId: context.organizationId,
    targetType: 'user',
    targetId: userRow.id,
    targetLabel: userRow.email,
    details: { role },
  });

  // organization_members.is_active defaults true (migration 070), same as the
  // membership row addUserToOrganization just created.
  return jsonResponse(serializeUser(userRow, role, true, true), 201);
}

/**
 * Handle PATCH /api/organizations/{orgId}/users/{userId}
 *
 * `role` and `isActive` both live on organization_members and so are scoped to
 * this organization; `name` lives on app.users and so is visible everywhere
 * the user is. Flipping isActive requires a direct membership row, the same
 * requirement updateOrganizationMember already enforces for role — a site-only
 * member has neither to change. Neither field is editable on an owner, at any
 * head count: see ASSIGNABLE_ORG_ROLES above.
 */
async function handleUpdateOrgUser(
  request: Request,
  context: OrgUsersRouteContext,
): Promise<Response> {
  const targetUserId = context.userId;
  if (targetUserId === undefined || targetUserId === '') {
    return errorResponse('userId is required', 400);
  }

  if (await isSelfEdit(context)) {
    return errorResponse('You cannot change your own membership', 409);
  }

  if (!(await isUserInOrganization(targetUserId, context.organizationId))) {
    return errorResponse('User not found in this organization', 404);
  }

  const body = await parseJsonBody<UpdateOrgUserBody>(request);
  if (body === undefined) {
    return errorResponse('Invalid JSON body', 400);
  }

  if (body.name === undefined && body.role === undefined && body.isActive === undefined) {
    return errorResponse('No fields to update', 400);
  }

  if (body.role !== undefined && !isAssignableOrgRole(body.role)) {
    return errorResponse(
      `Invalid role. Must be one of: ${ASSIGNABLE_ORG_ROLES.join(', ')}`,
      400,
    );
  }

  // All guards run before any write. Role and isActive are written atomically
  // in a single UPDATE (updateOrganizationMember) so a mid-request failure
  // cannot leave one field committed while the other is not.
  const currentRole = body.role !== undefined || body.isActive !== undefined
    ? await getOrganizationRole(context.organizationId, targetUserId)
    : null;

  // Ownership only ever changes through a dedicated transfer, never this
  // roster API — no head-count exception, unlike the last-admin guard below.
  // An owner's role and active state are untouchable here even when the
  // account has several owners.
  if (currentRole === 'owner') {
    return errorResponse(
      body.role !== undefined
        ? 'Cannot change the role of an owner of an organization; transfer ownership instead'
        : 'Cannot change the active status of an owner of an organization; transfer ownership instead',
      409,
    );
  }

  // Demoting or deactivating the last admin both leave the account with nobody
  // able to manage it, including nobody able to undo it — isOrgAdmin refuses a
  // deactivated member, so suspending the last one locks the account out just
  // as a demotion would. countOrganizationAdmins counts only active admins and
  // includes the owner, so an account with an owner never trips this.
  if (
    (body.role === 'member' || body.isActive === false)
    && currentRole === 'admin'
    && (await countOrganizationAdmins(context.organizationId)) <= 1
  ) {
    return errorResponse(
      body.role === 'member'
        ? 'Cannot remove the last admin of an organization'
        : 'Cannot deactivate the last admin of an organization',
      409,
    );
  }

  // Single atomic write for both role and isActive. Returns null when there is
  // no direct membership row — a site-only member has neither to change.
  let memberResult: { role: OrganizationRole; isActive: boolean } | null = null;
  if (body.role !== undefined || body.isActive !== undefined) {
    memberResult = await updateOrganizationMember(context.organizationId, targetUserId, {
      role: body.role,
      isActive: body.isActive,
    });
    if (memberResult === null) {
      return errorResponse('User is not a direct member of this organization', 404);
    }
  }

  const isActive = memberResult?.isActive
    ?? await isOrganizationMemberActive(context.organizationId, targetUserId);

  let row: UserRow | undefined;

  if (body.name !== undefined) {
    const result = await db()
      .update(users)
      .set({ name: body.name.trim(), updatedAt: sql`NOW()` })
      .where(eq(users.id, targetUserId))
      .returning(USER_COLUMNS);
    row = result[0];
  } else {
    const result = await db().select(USER_COLUMNS).from(users).where(eq(users.id, targetUserId));
    row = result[0];
  }

  if (row === undefined) {
    return errorResponse('User not found', 404);
  }

  const role = (await getOrganizationRole(context.organizationId, targetUserId)) ?? 'member';

  await recordAuditEntry({
    action: 'org_user.update',
    actor: context.principal,
    organizationId: context.organizationId,
    targetType: 'user',
    targetId: targetUserId,
    targetLabel: row.email,
    // Only the fields the request actually set — an absent key means untouched,
    // which a null would not.
    details: {
      ...(body.name !== undefined && { name: row.name }),
      ...(body.role !== undefined && { role: body.role }),
      ...(body.isActive !== undefined && { isActive }),
    },
  });

  return jsonResponse(serializeUser(row, role, true, isActive));
}

/**
 * Handle DELETE /api/organizations/{orgId}/users/{userId}
 *
 * Removes the org membership only — the app.users row and any other org
 * memberships survive. Refuses to empty an organization out entirely, to
 * leave one with no admin, or to remove an owner at all.
 */
async function handleRemoveOrgUser(context: OrgUsersRouteContext): Promise<Response> {
  const targetUserId = context.userId;
  if (targetUserId === undefined || targetUserId === '') {
    return errorResponse('userId is required', 400);
  }

  if (await isSelfEdit(context)) {
    return errorResponse('You cannot remove yourself from this organization', 409);
  }

  // Establish what the target actually is before applying either guard below.
  // The roster lists everyone who reaches the account, which includes people
  // who only hold a role on one of its sites (getUsersForOrganization) and so
  // have no membership row to delete. Both guards are about the membership
  // table, and checking them first refused those removals with a count that
  // had nothing to do with the user being removed: in an account with a single
  // direct member, removing a site-only collaborator failed as "cannot remove
  // the last member".
  const targetRole = await getOrganizationRole(context.organizationId, targetUserId);
  if (targetRole === null) {
    return errorResponse(
      'User is not a direct member of this organization; revoke their access on the site instead',
      404,
    );
  }

  // Checked ahead of the count guards: "you cannot remove an owner" is the
  // real reason, and reporting "cannot remove the last member" for the sole
  // member of a one-person account would send the caller looking for a second
  // member to add rather than for the transfer they actually need. No
  // head-count exception, unlike the last-admin/last-member guards below: an
  // owner is untouchable here even when the account has several.
  if (targetRole === 'owner') {
    return errorResponse(
      'Cannot remove an owner of an organization; transfer ownership instead',
      409,
    );
  }

  if (await countOrganizationMembers(context.organizationId) <= 1) {
    return errorResponse(
      'Cannot remove the last member of an organization',
      409,
    );
  }

  if (
    targetRole === 'admin'
    && (await countOrganizationAdmins(context.organizationId)) <= 1
  ) {
    return errorResponse(
      'Cannot remove the last admin of an organization',
      409,
    );
  }

  const removed = await removeUserFromOrganization(context.organizationId, targetUserId);
  if (!removed) {
    // The membership read above said otherwise, so this is a concurrent
    // removal rather than a caller mistake.
    return errorResponse('User is not a direct member of this organization', 404);
  }

  // Read the email for the audit label: the response is a 204 and nothing else
  // in this handler needs the user row, so it is fetched here or not at all.
  const removedUserRows = await db().select({ email: users.email }).from(users).where(eq(users.id, targetUserId));

  await recordAuditEntry({
    action: 'org_user.remove',
    actor: context.principal,
    organizationId: context.organizationId,
    targetType: 'user',
    targetId: targetUserId,
    targetLabel: removedUserRows[0]?.email,
    details: { role: targetRole },
  });

  return new Response(null, { status: 204 });
}

/**
 * Main route handler for organization user operations
 */
export async function handleOrgUsersRoutes(
  request: Request,
  context: OrgUsersRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    if (context.organizationId === '') {
      return errorResponse('Organization ID is required', 400);
    }

    // Managing a business account's roster — including merely reading it — is
    // an administrative act. An ordinary member of the account gets nothing
    // here, which is what lets the dashboard hide the Users tab from them
    // outright rather than showing a tab that only ever errors.
    //
    // isOrgAdmin already requires an active membership row and passes every
    // superadmin, so a separate organization-access check adds a round trip and
    // tells an outsider which of the two answers they failed.
    if (!(await isOrgAdmin(context.principal, context.organizationId))) {
      return errorResponse('Access denied to the specified organization', 403);
    }

    if (context.userId !== undefined) {
      switch (method) {
        case 'PATCH':
          return await handleUpdateOrgUser(request, context);
        case 'DELETE':
          return await handleRemoveOrgUser(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    switch (method) {
      case 'GET':
        return await handleListOrgUsers(context);
      case 'POST':
        return await handleAddOrgUser(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    getLogger().error('Organization users API error', error instanceof Error ? error : new Error(String(error)), {});
    return errorResponse('Internal server error', 500);
  }
}
