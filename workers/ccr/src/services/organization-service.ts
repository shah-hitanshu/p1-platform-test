/**
 * Agent Politeness System - Phase 1.3: Organization Service
 *
 * CRUD operations for Organizations.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * @see collaborative-state-system-architecture-v2.3.md Section "Agent Politeness System"
 */

import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { Organization, OrganizationSettings, Site, WorkflowSettings } from '../types';
import { driverErrorCode } from '../db/driver-error';
import { toIsoTimestamp } from '../db/helpers';
import { db, transaction } from '../db/scope';
import { organizationMembers, organizations, sites } from '../db/schema';
import { escapeLikePattern } from './document-types';
import { PUBLIC_EMAIL_DOMAINS } from '../constants/email-domains';
import {
  InvalidOrganizationParamsError,
  OrganizationHasSitesError,
  OrganizationHasActiveSitesError,
  OrganizationNotFoundError,
} from './errors';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new organization.
 */
export interface CreateOrganizationParams {
  name: string;
  settings?: Partial<OrganizationSettings>;
}

/**
 * Parameters for updating an organization.
 */
export interface UpdateOrganizationParams {
  name?: string;
  settings?: Partial<OrganizationSettings>;
}

/**
 * A member's role within one business account (PCC-3479).
 *
 * Distinct from app.users.system_role, which is platform-wide: administering
 * the account you set up for yourself must not make you an administrator of
 * every account you are invited to.
 */
export type OrganizationRole = 'owner' | 'admin' | 'member';

/**
 * The roles that administer a business account.
 *
 * `owner` is an admin — the person the account was created for — that the
 * roster API additionally refuses to demote or remove while they are the last
 * one. Every admin check must accept both, or the owner of a single-member
 * account would be locked out of their own roster.
 */
export const ORG_ADMIN_ROLES: readonly OrganizationRole[] = ['owner', 'admin'];

/**
 * Narrows a stored role to OrganizationRole.
 *
 * Anything unrecognised reads as plain membership: rows predating 068 carried
 * no role at all, and a value the CHECK constraint has never allowed should
 * grant nothing rather than be trusted.
 */
function normalizeOrgRole(value: string | null | undefined): OrganizationRole {
  return value === 'owner' || value === 'admin' ? value : 'member';
}

/** An organization plus the calling user's role in it. */
export type OrganizationWithRole = Organization & { role: OrganizationRole };

/**
 * Options for listing organizations.
 */
export interface ListOrganizationsOptions {
  limit?: number;
  offset?: number;
  /** Filter by archived state. true = archived only, false/undefined = active only. */
  archived?: boolean;
}

/**
 * A row of organization columns.
 *
 * The timestamps are typed for both readers: the query builder hands back a
 * Date, a raw statement Postgres' own text form. Both go through
 * toIsoTimestamp. A type alias rather than an interface: db().execute<T>()
 * constrains T to Record<string, unknown>, which an interface cannot satisfy
 * because it carries no implicit index signature.
 */
type OrganizationRow = {
  id: string;
  name: string;
  settings: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  archivedAt: Date | string | null;
  externalSpaceId?: string | null;
  ownerEmail?: string | null;
  /** Only selected by the "organizations I belong to" queries. */
  memberRole?: string | null;
};

/**
 * A row of site columns. url, allowed_origins and archived_at are not selected
 * by every read; absent, they map to the same values as a NULL column.
 */
interface SiteRow {
  id: string;
  pantheonSiteId: string | null;
  organizationId: string | null;
  name: string;
  workflowSettings: unknown;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  url?: string | null;
  allowedOrigins?: string[] | null;
  archivedAt?: Date | string | null;
}

/** Columns every organization read selects, in the schema's property names. */
const organizationColumns = {
  id: organizations.id,
  name: organizations.name,
  settings: organizations.settings,
  createdAt: organizations.createdAt,
  updatedAt: organizations.updatedAt,
  archivedAt: organizations.archivedAt,
};

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default organization settings as defined in the database schema.
 */
const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  agentIdleTimeoutMs: 5000,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parses organization settings from database.
 * Handles both string and object formats for JSONB columns.
 */
function parseSettings(value: unknown): OrganizationSettings {
  if (typeof value === 'string') {
    return JSON.parse(value) as OrganizationSettings;
  }
  return value as OrganizationSettings;
}

/**
 * Parses workflow settings from database.
 */
function parseWorkflowSettings(value: unknown): WorkflowSettings {
  if (typeof value === 'string') {
    return JSON.parse(value) as WorkflowSettings;
  }
  return value as WorkflowSettings;
}

/**
 * Maps a database row to an Organization domain object.
 */
function mapRowToOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    settings: parseSettings(row.settings),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    archivedAt: row.archivedAt == null ? null : toIsoTimestamp(row.archivedAt),
    externalSpaceId: row.externalSpaceId ?? null,
    ownerEmail: row.ownerEmail ?? undefined,
  };
}

/**
 * Maps a row from one of the "organizations I belong to" queries, attaching the
 * caller's role. A null member_role means they reach the org through a site
 * role rather than a membership row, which is plain membership.
 */
function mapRowToOrganizationWithRole(row: OrganizationRow): OrganizationWithRole {
  return {
    ...mapRowToOrganization(row),
    role: normalizeOrgRole(row.memberRole),
  };
}

/**
 * Maps a database row to a Site domain object.
 */
function mapRowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    pantheonSiteId: row.pantheonSiteId ?? undefined,
    organizationId: row.organizationId ?? undefined,
    name: row.name,
    url: row.url ?? undefined,
    workflowSettings: parseWorkflowSettings(row.workflowSettings),
    allowedOrigins: row.allowedOrigins ?? [],
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    archivedAt: row.archivedAt == null ? null : toIsoTimestamp(row.archivedAt),
  };
}

/**
 * Checks if an error is a PostgreSQL foreign key constraint violation.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return driverErrorCode(error) === '23503';
}

const MAX_ORG_NAME_LENGTH = 255;
// Control characters, CR/LF included: an org name flows into an invite
// email's subject line and into UI text, neither of which expects them.
// eslint-disable-next-line no-control-regex -- deliberately matching control chars
const ORG_NAME_CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

/**
 * Whether a string is safe to store as an organization name: non-empty after
 * trim, within the 255-char cap `users-api.ts` already enforces on
 * spaceName, and free of control characters.
 */
export function isValidOrgName(name: string): boolean {
  return (
    name.trim() !== ''
    && name.length <= MAX_ORG_NAME_LENGTH
    && !ORG_NAME_CONTROL_CHAR_PATTERN.test(name)
  );
}

/**
 * Validates organization name for the explicit create/update paths, which
 * reject an invalid name outright. Derived paths (linkOrgToSpace,
 * createOrgForUser) call isValidOrgName directly and degrade instead of
 * throwing — see their own comments.
 */
function validateName(name: string | undefined): void {
  if (name !== undefined && !isValidOrgName(name)) {
    throw new InvalidOrganizationParamsError(
      'Organization name must be non-empty, at most 255 characters, and free of control characters.',
    );
  }
}

/**
 * The account owner's email. An account may have several, so this is the
 * earliest of them; ordering rather than a WHERE so one whose owner rows were
 * deleted out of band still reports an email — its earliest member, which is
 * who 068's backfill would name — instead of going null.
 *
 * `orgId` is how the enclosing statement refers to the organization it is
 * reading, which differs between a builder query and a raw one. It has to be
 * qualified: the subquery's own tables carry an `id` too.
 */
function earliestOwnerEmail(orgId: SQL): SQL<string | null> {
  return sql<string | null>`(
    SELECT owner_u.email FROM app.organization_members owner_om
    JOIN app.users owner_u ON owner_u.id = owner_om.user_id
    WHERE owner_om.organization_id = ${orgId}
    ORDER BY (owner_om.role = 'owner') DESC, owner_om.created_at, owner_om.id
    LIMIT 1)`;
}

/** Non-archived sites an organization still owns. */
async function countActiveSites(organizationId: string): Promise<number> {
  const [row] = await db()
    .select({ value: count() })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), isNull(sites.archivedAt)));

  return row?.value ?? 0;
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Creates a new organization.
 *
 * @param params - Organization creation parameters
 * @returns The created organization
 * @throws InvalidOrganizationParamsError if name is empty
 */
export async function createOrganization(params: CreateOrganizationParams): Promise<Organization> {
  validateName(params.name);

  const settings: OrganizationSettings = {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    ...params.settings,
  };

  const [createdRow] = await db()
    .insert(organizations)
    .values({ name: params.name, settings })
    .returning(organizationColumns);

  if (!createdRow) {
    throw new Error('Failed to create organization');
  }
  return mapRowToOrganization(createdRow);
}

/**
 * Gets an organization by ID.
 *
 * @param id - Organization ID
 * @returns The organization or null if not found
 */
export async function getOrganizationById(id: string): Promise<Organization | null> {
  const [orgRow] = await db()
    .select(organizationColumns)
    .from(organizations)
    .where(eq(organizations.id, id));

  if (!orgRow) {
    return null;
  }
  return mapRowToOrganization(orgRow);
}

/**
 * Updates an organization.
 *
 * @param id - Organization ID
 * @param params - Update parameters
 * @returns The updated organization or null if not found
 * @throws InvalidOrganizationParamsError if name is empty
 */
export async function updateOrganization(
  id: string,
  params: UpdateOrganizationParams,
): Promise<Organization | null> {
  validateName(params.name);

  if (params.name === undefined && params.settings === undefined) {
    // No updates to apply, just return current state
    return getOrganizationById(id);
  }

  const [updatedRow] = await db()
    .update(organizations)
    .set({
      ...(params.name !== undefined ? { name: params.name } : {}),
      // Settings merge rather than replace. The new values are stringified
      // because they are bound into a jsonb operator: the Drizzle client
      // serializes json as identity, so an object would reach Postgres as
      // [object Object].
      ...(params.settings !== undefined
        ? { settings: sql`${organizations.settings} || ${JSON.stringify(params.settings)}::jsonb` }
        : {}),
      updatedAt: sql`NOW()`,
    })
    .where(eq(organizations.id, id))
    .returning(organizationColumns);

  if (!updatedRow) {
    return null;
  }
  return mapRowToOrganization(updatedRow);
}

/**
 * Deletes an organization.
 *
 * @param id - Organization ID
 * @returns true if deleted, false if not found
 * @throws OrganizationHasSitesError if organization has linked sites
 */
export async function deleteOrganization(id: string): Promise<boolean> {
  try {
    const deleted = await db()
      .delete(organizations)
      .where(eq(organizations.id, id))
      .returning({ id: organizations.id });

    return deleted.length > 0;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new OrganizationHasSitesError(id);
    }
    throw error;
  }
}

/**
 * Soft-deletes an organization by setting archived_at.
 * Blocked if the org has active (non-archived) sites.
 * Returns true on success, false if not found, 'already_archived' if already soft-deleted.
 */
export async function archiveOrganization(id: string): Promise<boolean | 'already_archived'> {
  // Pre-check active sites outside the transaction to surface a clean error early.
  // The UPDATE itself also guards via a NOT EXISTS subquery to prevent TOCTOU.
  if (await countActiveSites(id) > 0) {
    throw new OrganizationHasActiveSitesError(id);
  }

  const archived = await transaction(() =>
    db()
      .update(organizations)
      .set({ archivedAt: sql`NOW()` })
      .where(
        and(
          eq(organizations.id, id),
          isNull(organizations.archivedAt),
          notExists(
            db()
              .select({ id: sites.id })
              .from(sites)
              .where(and(eq(sites.organizationId, id), isNull(sites.archivedAt))),
          ),
        ),
      )
      .returning({ id: organizations.id }),
  );

  // Post-commit: UPDATE matched — done.
  if (archived.length > 0) {
    return true;
  }

  // UPDATE matched 0 rows. Re-check outside the transaction to avoid ROLLBACK
  // on an already-committed transaction (PostgreSQL emits a WARNING for that).
  if (await countActiveSites(id) > 0) {
    throw new OrganizationHasActiveSitesError(id);
  }
  const exists = await db()
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, id));

  return exists.length > 0 ? 'already_archived' : false;
}

/**
 * Restores a soft-deleted organization.
 * Returns true on success, false if not found or not archived.
 */
export async function restoreOrganization(id: string): Promise<boolean> {
  const restored = await transaction(() =>
    db()
      .update(organizations)
      .set({ archivedAt: null })
      .where(and(eq(organizations.id, id), isNotNull(organizations.archivedAt)))
      .returning({ id: organizations.id }),
  );

  return restored.length > 0;
}

/**
 * Lists all organizations with optional pagination.
 *
 * @param options - Pagination and filter options
 * @returns Array of organizations
 */
export async function listOrganizations(
  options: ListOrganizationsOptions = {},
): Promise<Organization[]> {
  const { limit = 100, offset = 0, archived } = options;

  const rows = await db()
    .select(organizationColumns)
    .from(organizations)
    .where(archived === true ? isNotNull(organizations.archivedAt) : isNull(organizations.archivedAt))
    .orderBy(desc(organizations.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(mapRowToOrganization);
}

/**
 * Links a site to an organization.
 *
 * @param siteId - Site ID
 * @param organizationId - Organization ID
 * @returns true if linked, false if site not found
 * @throws OrganizationNotFoundError if organization does not exist
 */
export async function linkSiteToOrganization(
  siteId: string,
  organizationId: string,
): Promise<boolean> {
  try {
    const linked = await db()
      .update(sites)
      .set({ organizationId, updatedAt: sql`NOW()` })
      .where(eq(sites.id, siteId))
      .returning({ id: sites.id });

    return linked.length > 0;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new OrganizationNotFoundError(organizationId);
    }
    throw error;
  }
}

/**
 * Unlinks a site from its organization.
 *
 * @param siteId - Site ID
 * @returns true if unlinked, false if site not found
 */
export async function unlinkSiteFromOrganization(siteId: string): Promise<boolean> {
  const unlinked = await db()
    .update(sites)
    .set({ organizationId: null, updatedAt: sql`NOW()` })
    .where(eq(sites.id, siteId))
    .returning({ id: sites.id });

  return unlinked.length > 0;
}

/**
 * Gets all sites for an organization.
 *
 * @param organizationId - Organization ID
 * @returns Array of sites
 */
export async function getSitesByOrganization(organizationId: string): Promise<Site[]> {
  const rows = await db()
    .select({
      id: sites.id,
      pantheonSiteId: sites.pantheonSiteId,
      organizationId: sites.organizationId,
      name: sites.name,
      workflowSettings: sites.workflowSettings,
      createdAt: sites.createdAt,
      updatedAt: sites.updatedAt,
    })
    .from(sites)
    .where(eq(sites.organizationId, organizationId))
    .orderBy(asc(sites.name));

  return rows.map(mapRowToSite);
}

/**
 * Gets the organization for a site.
 *
 * @param siteId - Site ID
 * @returns The organization or null if site has no organization
 */
export async function getOrganizationForSite(siteId: string): Promise<Organization | null> {
  const [siteOrgRow] = await db()
    .select(organizationColumns)
    .from(organizations)
    .innerJoin(sites, eq(sites.organizationId, organizations.id))
    .where(eq(sites.id, siteId));

  if (!siteOrgRow) {
    return null;
  }
  return mapRowToOrganization(siteOrgRow);
}

// =============================================================================
// Business Accounts Phase 1
// =============================================================================

/**
 * Mirrors Postgres' INITCAP: uppercases the first letter of each run of
 * alphanumeric characters and lowercases the rest, leaving separators
 * (hyphens, etc.) untouched. Kept in sync with migration
 * 067_backfill_organizations.sql's use of INITCAP so a company name like
 * "big-corp.com" derives to "Big-Corp" at both migration time and runtime.
 */
function toInitCap(value: string): string {
  return value.replace(/[a-z0-9]+/gi, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function deriveOrgNameFromEmail(email: string): string {
  const [username, domain] = email.toLowerCase().split('@');
  if (domain === undefined) return email;

  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return username ?? email;
  }

  const company = domain.split('.')[0];
  if (company === undefined) return domain;
  return toInitCap(company);
}

/**
 * Returns all organizations a user belongs to — via direct membership
 * or via site roles on sites that belong to an organization.
 *
 * Each carries the user's role in it. Reaching an org only through a site role
 * makes you a member of it, never an admin: administering the account is
 * granted on the account, not inherited from one of its sites.
 *
 * Membership must match canAccessOrganization, is_active included, or the
 * switcher offers an account whose every scoped request comes back 403.
 *
 * DISTINCT over two correlated EXISTS clauses has no builder form, so the
 * statement is raw; it names its columns as the schema does so the same mapper
 * reads it.
 */
export async function getOrganizationsForUser(userId: string): Promise<OrganizationWithRole[]> {
  const rows = await db().execute<OrganizationRow>(sql`
    SELECT DISTINCT o.id, o.name, o.settings,
           o.created_at AS "createdAt", o.updated_at AS "updatedAt",
           o.archived_at AS "archivedAt", o.external_space_id AS "externalSpaceId",
           (SELECT mine.role FROM app.organization_members mine
            WHERE mine.organization_id = o.id AND mine.user_id = ${userId}::uuid
              AND mine.is_active = true) AS "memberRole",
           ${earliestOwnerEmail(sql`o.id`)} AS "ownerEmail"
    FROM app.organizations o
    WHERE o.archived_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM app.organization_members om
          WHERE om.organization_id = o.id AND om.user_id = ${userId}::uuid
            AND om.is_active = true
        )
        OR
        EXISTS (
          SELECT 1 FROM app.user_site_roles usr
          INNER JOIN app.users u ON u.id::text = usr.user_id
          INNER JOIN app.sites s ON s.id = usr.site_id
          WHERE u.id = ${userId}::uuid AND s.organization_id = o.id AND s.archived_at IS NULL
        )
      )
  `);

  return rows.map(mapRowToOrganizationWithRole);
}

/**
 * Returns every non-archived organization, in the same shape as
 * getOrganizationsForUser (including external_space_id and owner_email so the
 * frontend can merge them with PCC spaces).
 *
 * PCC-3479: backs the superadmin view of the business-account switcher. Every
 * org comes back as `admin`, because that is what the role means — a superadmin
 * administers accounts they were never made a member of.
 */
export const SWITCHER_ORG_LIMIT = 500;

export async function listAllOrganizationsForSwitcher(
  limit = SWITCHER_ORG_LIMIT,
): Promise<OrganizationWithRole[]> {
  const rows = await db()
    .select({
      ...organizationColumns,
      externalSpaceId: organizations.externalSpaceId,
      memberRole: sql<string>`'admin'`,
      ownerEmail: earliestOwnerEmail(sql`app.organizations.id`),
    })
    .from(organizations)
    .where(isNull(organizations.archivedAt))
    .orderBy(asc(organizations.name))
    .limit(limit);

  return rows.map(mapRowToOrganizationWithRole);
}

/**
 * A user as seen from inside an organization.
 */
export interface OrganizationUser {
  id: string;
  email: string;
  name: string | null;
  principalId: string | null;
  authProvider: string | null;
  /** Platform-wide role. Read-only here; shown so a superadmin is recognizable. */
  systemRole: string;
  /**
   * Role in *this* organization — what the Users tab edits. Site-role-only
   * users have no membership row and so count as plain members.
   */
  role: OrganizationRole;
  /**
   * Active in *this* organization's membership row; true for site-role-only
   * users, who have no such row to deactivate.
   */
  isActive: boolean;
  /**
   * true when the user is in organization_members; false when they only reach
   * the org through a site role. Site-role-only users cannot be removed from
   * the org directly — their access comes from the site grant.
   */
  isDirectMember: boolean;
  createdAt: string;
  updatedAt: string;
}

type OrganizationUserRow = {
  id: string;
  email: string;
  name: string | null;
  principalId: string | null;
  authProvider: string | null;
  systemRole: string;
  memberRole: string | null;
  memberIsActive: boolean | null;
  isDirectMember: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

/**
 * Returns every user who belongs to an organization, using the same membership
 * definition as getOrganizationsForUser (direct membership OR a site role on
 * one of the org's sites).
 */
export async function getUsersForOrganization(organizationId: string): Promise<OrganizationUser[]> {
  const rows = await db().execute<OrganizationUserRow>(sql`
    SELECT DISTINCT
      u.id, u.email, u.name,
      u.principal_id AS "principalId", u.auth_provider AS "authProvider",
      u.system_role AS "systemRole",
      u.created_at AS "createdAt", u.updated_at AS "updatedAt",
      (
        SELECT direct.role FROM app.organization_members direct
        WHERE direct.organization_id = ${organizationId}::uuid AND direct.user_id = u.id
      ) AS "memberRole",
      (
        SELECT direct.is_active FROM app.organization_members direct
        WHERE direct.organization_id = ${organizationId}::uuid AND direct.user_id = u.id
      ) AS "memberIsActive",
      EXISTS (
        SELECT 1 FROM app.organization_members direct
        WHERE direct.organization_id = ${organizationId}::uuid AND direct.user_id = u.id
      ) AS "isDirectMember"
    FROM app.users u
    WHERE EXISTS (
        SELECT 1 FROM app.organization_members om
        WHERE om.organization_id = ${organizationId}::uuid AND om.user_id = u.id
      )
      OR EXISTS (
        SELECT 1 FROM app.user_site_roles usr
        INNER JOIN app.sites s ON s.id = usr.site_id
        WHERE usr.user_id = u.id::text
          AND s.organization_id = ${organizationId}::uuid
          AND s.archived_at IS NULL
      )
    ORDER BY "createdAt" ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    principalId: row.principalId,
    authProvider: row.authProvider,
    systemRole: row.systemRole,
    role: normalizeOrgRole(row.memberRole),
    isActive: row.memberIsActive ?? true,
    isDirectMember: row.isDirectMember,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }));
}

/**
 * Adds a user to an organization's direct membership.
 *
 * @returns true when a membership row was created, false when it already existed
 * @throws OrganizationNotFoundError if the organization does not exist
 */
export async function addUserToOrganization(
  organizationId: string,
  userId: string,
  role: OrganizationRole = 'member',
): Promise<boolean> {
  try {
    const inserted = await db()
      .insert(organizationMembers)
      .values({ organizationId, userId, role })
      .onConflictDoNothing({
        target: [organizationMembers.organizationId, organizationMembers.userId],
      })
      .returning({ id: organizationMembers.id });

    return inserted.length > 0;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new OrganizationNotFoundError(organizationId);
    }
    throw error;
  }
}

/**
 * The user's role in one organization, or null when they have no membership
 * row — which includes reaching the org only through a site role.
 */
export async function getOrganizationRole(
  organizationId: string,
  userId: string,
): Promise<OrganizationRole | null> {
  const [row] = await db()
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    );

  if (row === undefined) {
    return null;
  }
  return normalizeOrgRole(row.role);
}

/**
 * Atomically updates the role and/or isActive state of a direct membership row.
 *
 * Both columns are written in a single UPDATE so a mid-request failure cannot
 * leave one committed while the other is not. Omit a field to leave it unchanged.
 *
 * @returns the updated values, or null when no membership row was found
 */
export async function updateOrganizationMember(
  organizationId: string,
  userId: string,
  fields: { role?: OrganizationRole; isActive?: boolean },
): Promise<{ role: OrganizationRole; isActive: boolean } | null> {
  const [row] = await db()
    .update(organizationMembers)
    .set({
      role: sql`COALESCE(${fields.role ?? null}::text, ${organizationMembers.role})`,
      isActive: sql`COALESCE(${fields.isActive ?? null}, ${organizationMembers.isActive})`,
    })
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .returning({ role: organizationMembers.role, isActive: organizationMembers.isActive });

  if (row === undefined) return null;
  return { role: normalizeOrgRole(row.role), isActive: row.isActive };
}

/**
 * Whether a user's direct membership in an organization is active, so a
 * caller who didn't touch isActive in a PATCH can still be told the current
 * value. Defaults true for a site-role-only user, who has no membership row
 * to deactivate.
 */
export async function isOrganizationMemberActive(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db()
    .select({ isActive: organizationMembers.isActive })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    );

  return row?.isActive ?? true;
}

/**
 * Counts the admins of an organization, so the last one can't be demoted or
 * removed and leave the account unmanageable.
 *
 * The owner counts: they administer the account, and an account whose only
 * administrator is its owner must not read as having none — that would let the
 * roster API demote its last real admin on the grounds that nobody was in
 * charge anyway.
 *
 * Only active members count. isOrgAdmin refuses a deactivated one, so counting
 * them here would let the last admin who can actually administer the account be
 * demoted on the strength of one who cannot.
 */
export async function countOrganizationAdmins(organizationId: string): Promise<number> {
  const [row] = await db()
    .select({ value: count() })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        inArray(organizationMembers.role, ['admin', 'owner']),
        eq(organizationMembers.isActive, true),
      ),
    );

  return row?.value ?? 0;
}

/**
 * Removes a user's direct membership in an organization.
 * Site-role-derived access is untouched — revoke the site grant for that.
 *
 * @returns true if a membership row was deleted, false if there was none
 */
export async function removeUserFromOrganization(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const removed = await db()
    .delete(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .returning({ id: organizationMembers.id });

  return removed.length > 0;
}

/**
 * Counts active direct members of an organization (used to refuse orphaning an
 * org). Deactivated members are excluded for the same reason as
 * countOrganizationAdmins: they cannot reach the account through membership.
 */
export async function countOrganizationMembers(organizationId: string): Promise<number> {
  const [row] = await db()
    .select({ value: count() })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.isActive, true),
      ),
    );

  return row?.value ?? 0;
}

/**
 * PCC-3479: does this email already have a home in P1 — an org membership or a
 * site role? Content Publisher asks this before provisioning a Stigg
 * subscription: a user invited into someone else's business account must not be
 * pushed through business-account setup on first sign-in.
 *
 * A bare app.users row is deliberately not enough — a self-service signup with
 * no org yet still needs the normal setup flow.
 *
 * Membership is tested exactly as canAccessOrganization tests it: a suspended
 * membership or an archived site is not a home the user can actually reach.
 */
export async function isEmailInAnyOrganization(email: string): Promise<boolean> {
  const rows = await db().execute(sql`
    SELECT 1 FROM app.users u
    WHERE u.email = ${email.toLowerCase()}
      AND u.is_active = true
      AND (
        EXISTS (
          SELECT 1 FROM app.organization_members om
          WHERE om.user_id = u.id AND om.is_active = true
        )
        OR EXISTS (
          SELECT 1 FROM app.user_site_roles usr
          INNER JOIN app.sites s ON s.id = usr.site_id
          WHERE usr.user_id = u.id::text AND s.archived_at IS NULL
        )
      )
    LIMIT 1
  `);

  return rows.length > 0;
}

/**
 * Returns the org the user owns — the earliest active organization_members
 * row with role = 'owner' — or null if they don't own one. Deliberately not
 * "the earliest membership row": that includes accounts the user was invited
 * into, which must never be treated as theirs to relink or rename.
 *
 * PCC-3987: also excludes an archived org and adds a deterministic tiebreak.
 * A dead org must not be "owned" just because its membership row sorts
 * first, and 068's backfill stamped many memberships with the same
 * created_at, so ties on created_at alone were arbitrary.
 */
export async function getUserOwnedOrg(userId: string): Promise<string | null> {
  const [row] = await db()
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.isActive, true),
        eq(organizationMembers.role, 'owner'),
        isNull(organizations.archivedAt),
      ),
    )
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id))
    .limit(1);

  return row?.organizationId ?? null;
}

/**
 * Whether the user has any active membership at all, owned or not. Separates
 * "genuinely orgless" from "a member of someone else's account" — the latter
 * must not fall through to creating them a new one.
 */
export async function hasActiveOrgMembership(userId: string): Promise<boolean> {
  const rows = await db()
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.isActive, true),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Checks whether a user belongs to an organization — via direct membership
 * or via site roles on non-archived sites in that org.
 *
 * Both paths run through app.users: organization_members.user_id is a foreign
 * key to it, so a membership row cannot exist without the user row the
 * statement reads from.
 */
export async function isUserInOrganization(userId: string, organizationId: string): Promise<boolean> {
  const rows = await db().execute(sql`
    SELECT 1 FROM app.users u
    WHERE u.id = ${userId}::uuid
      AND (
        EXISTS (
          SELECT 1 FROM app.organization_members om
          WHERE om.user_id = u.id AND om.organization_id = ${organizationId}::uuid
        )
        OR EXISTS (
          SELECT 1 FROM app.user_site_roles usr
          INNER JOIN app.sites s ON s.id = usr.site_id
          WHERE usr.user_id = u.id::text AND s.organization_id = ${organizationId}::uuid
            AND s.archived_at IS NULL
        )
      )
    LIMIT 1
  `);

  return rows.length > 0;
}

/**
 * Links an organization to a PCC space by setting external_space_id.
 * Optionally updates the org name to the PCC space name.
 * Only updates if the org's external_space_id is currently NULL.
 *
 * @returns true if linked, false if already linked or org not found
 */
export async function linkOrgToSpace(orgId: string, externalSpaceId: string, spaceName?: string): Promise<boolean> {
  // An invalid name (too long, control characters) links without renaming
  // rather than throwing: this is a derived write, and both callers catch
  // and log, so throwing here would leave the user with no organization at
  // all instead of one that's merely unrenamed.
  const hasValidName = spaceName !== undefined && spaceName.trim() !== '' && isValidOrgName(spaceName);

  const linked = await db()
    .update(organizations)
    .set({
      externalSpaceId,
      ...(hasValidName ? { name: spaceName } : {}),
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(organizations.id, orgId), isNull(organizations.externalSpaceId)))
    .returning({ id: organizations.id });

  return linked.length > 0;
}

/**
 * Creates an organization for a user and adds them as a member.
 * Uses spaceName if provided, otherwise derives from email domain.
 * Handles duplicate org names by appending numbers.
 */
export async function createOrgForUser(
  userId: string,
  email: string,
  spaceName?: string,
  externalSpaceId?: string,
): Promise<Organization> {
  return transaction(async () => {
    let orgName: string;

    // An invalid spaceName (too long, control characters) falls back to the
    // derived name below instead of throwing — this is a derived write, not
    // a rejection point, so an attacker-controlled string is discarded
    // rather than surfaced as a 500 or half-created account.
    if (spaceName !== undefined && spaceName.trim() !== '' && isValidOrgName(spaceName)) {
      orgName = spaceName;
    } else {
      const baseName = deriveOrgNameFromEmail(email);
      // escapeLikePattern escapes with a backslash, which is LIKE's default
      // escape character.
      const escapedBase = escapeLikePattern(baseName);
      const existing = await db()
        .select({ name: organizations.name })
        .from(organizations)
        .where(
          or(eq(organizations.name, baseName), like(organizations.name, `${escapedBase} %`)),
        );

      if (existing.length === 0) {
        orgName = baseName;
      } else {
        const existingNames = new Set(existing.map((r) => r.name));
        if (!existingNames.has(baseName)) {
          orgName = baseName;
        } else {
          let counter = 2;
          while (existingNames.has(`${baseName} ${String(counter)}`)) {
            counter++;
          }
          orgName = `${baseName} ${String(counter)}`;
        }
      }
    }

    const settings: OrganizationSettings = { ...DEFAULT_ORGANIZATION_SETTINGS };

    const [orgRow] = await db()
      .insert(organizations)
      .values({ name: orgName, settings, externalSpaceId: externalSpaceId ?? null })
      .returning({ ...organizationColumns, externalSpaceId: organizations.externalSpaceId });

    if (orgRow === undefined) {
      throw new Error('Failed to create organization: insert returned no row');
    }
    const org = mapRowToOrganization(orgRow);

    // The person the account is being set up for owns it (PCC-3479). Without
    // this a self-service signup would own a business account they cannot add
    // anyone to. `owner` rather than `admin`: this is the row 068's backfill
    // would pick, and owner_email reads it directly.
    await db()
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId, role: 'owner' });

    return org;
  });
}
