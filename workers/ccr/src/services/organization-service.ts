/**
 * Agent Politeness System - Phase 1.3: Organization Service
 *
 * CRUD operations for Organizations.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * @see collaborative-state-system-architecture-v2.3.md Section "Agent Politeness System"
 */

import type { Organization, OrganizationSettings, Site, WorkflowSettings } from '../types';
import { query } from '../db';
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
 * Options for listing organizations.
 */
export interface ListOrganizationsOptions {
  limit?: number;
  offset?: number;
  /** Filter by archived state. true = archived only, false/undefined = active only. */
  archived?: boolean;
}

/**
 * Database row format for organizations.
 */
interface OrganizationRow {
  id: string;
  name: string;
  settings: OrganizationSettings | string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  external_space_id?: string | null;
  owner_email?: string | null;
}

/**
 * Database row format for sites with organization.
 */
interface SiteRow {
  id: string;
  pantheon_site_id: string | null;
  organization_id: string | null;
  name: string;
  url: string | null;
  workflow_settings: WorkflowSettings | string;
  allowed_origins: string[] | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

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
function parseSettings(value: OrganizationSettings | string): OrganizationSettings {
  if (typeof value === 'string') {
    return JSON.parse(value) as OrganizationSettings;
  }
  return value;
}

/**
 * Parses workflow settings from database.
 */
function parseWorkflowSettings(value: WorkflowSettings | string): WorkflowSettings {
  if (typeof value === 'string') {
    return JSON.parse(value) as WorkflowSettings;
  }
  return value;
}

/**
 * Maps a database row to an Organization domain object.
 */
function mapRowToOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    settings: parseSettings(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    externalSpaceId: row.external_space_id ?? null,
    ownerEmail: row.owner_email ?? undefined,
  };
}

/**
 * Maps a database row to a Site domain object.
 */
function mapRowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    pantheonSiteId: row.pantheon_site_id ?? undefined,
    organizationId: row.organization_id ?? undefined,
    name: row.name,
    url: row.url ?? undefined,
    workflowSettings: parseWorkflowSettings(row.workflow_settings),
    allowedOrigins: row.allowed_origins ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
  };
}

/**
 * Checks if an error is a PostgreSQL foreign key constraint violation.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23503'
  );
}

/**
 * Validates organization name.
 */
function validateName(name: string | undefined): void {
  if (name?.trim() === '') {
    throw new InvalidOrganizationParamsError('Organization name cannot be empty.');
  }
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

  const result = await query<OrganizationRow>(`
    INSERT INTO app.organizations (name, settings)
    VALUES ($1, $2)
    RETURNING id, name, settings, created_at, updated_at, archived_at
  `, [params.name, JSON.stringify(settings)]);

  const createdRow = result.rows[0];
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
  const result = await query<OrganizationRow>(`
    SELECT id, name, settings, created_at, updated_at, archived_at
    FROM app.organizations
    WHERE id = $1
  `, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  const orgRow = result.rows[0];
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

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.name !== undefined) {
    updates.push(`name = $${String(paramIndex)}`);
    values.push(params.name);
    paramIndex++;
  }

  if (params.settings !== undefined) {
    // Merge with existing settings
    updates.push(`settings = settings || $${String(paramIndex)}::jsonb`);
    values.push(JSON.stringify(params.settings));
    paramIndex++;
  }

  if (updates.length === 0) {
    // No updates to apply, just return current state
    return getOrganizationById(id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const result = await query<OrganizationRow>(`
    UPDATE app.organizations
    SET ${updates.join(', ')}
    WHERE id = $${String(paramIndex)}
    RETURNING id, name, settings, created_at, updated_at, archived_at
  `, values);

  if (result.rows.length === 0) {
    return null;
  }

  const updatedRow = result.rows[0];
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
    const result = await query<{ id: string }>(`
      DELETE FROM app.organizations
      WHERE id = $1
      RETURNING id
    `, [id]);

    return result.rows.length > 0;
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
  const siteCheck = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM app.sites WHERE organization_id = $1 AND archived_at IS NULL',
    [id],
  );
  if (parseInt(siteCheck.rows[0]?.count ?? '0', 10) > 0) {
    throw new OrganizationHasActiveSitesError(id);
  }

  await query('BEGIN');
  let rowCount: number;
  try {
    const result = await query<{ id: string }>(
      `UPDATE app.organizations SET archived_at = NOW()
       WHERE id = $1 AND archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM app.sites WHERE organization_id = $1 AND archived_at IS NULL
         )
       RETURNING id`,
      [id],
    );
    rowCount = result.rowCount ?? 0;
    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }

  // Post-commit: UPDATE matched — done.
  if (rowCount > 0) {
    return true;
  }

  // UPDATE matched 0 rows. Re-check outside the transaction to avoid ROLLBACK
  // on an already-committed transaction (PostgreSQL emits a WARNING for that).
  const recheck = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM app.sites WHERE organization_id = $1 AND archived_at IS NULL',
    [id],
  );
  if (parseInt(recheck.rows[0]?.count ?? '0', 10) > 0) {
    throw new OrganizationHasActiveSitesError(id);
  }
  const exists = await query<{ id: string }>(
    'SELECT id FROM app.organizations WHERE id = $1',
    [id],
  );
  return exists.rows.length > 0 ? 'already_archived' : false;
}

/**
 * Restores a soft-deleted organization.
 * Returns true on success, false if not found or not archived.
 */
export async function restoreOrganization(id: string): Promise<boolean> {
  await query('BEGIN');
  try {
    const result = await query<{ id: string }>(
      `UPDATE app.organizations SET archived_at = NULL
       WHERE id = $1 AND archived_at IS NOT NULL
       RETURNING id`,
      [id],
    );
    await query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
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
  const archivedFilter = archived === true ? 'AND archived_at IS NOT NULL' : 'AND archived_at IS NULL';

  const result = await query<OrganizationRow>(`
    SELECT id, name, settings, created_at, updated_at, archived_at
    FROM app.organizations
    WHERE TRUE ${archivedFilter}
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  return result.rows.map(mapRowToOrganization);
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
    const result = await query<{ id: string }>(`
      UPDATE app.sites
      SET organization_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id
    `, [organizationId, siteId]);

    return result.rows.length > 0;
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
  const result = await query<{ id: string }>(`
    UPDATE app.sites
    SET organization_id = NULL, updated_at = NOW()
    WHERE id = $1
    RETURNING id
  `, [siteId]);

  return result.rows.length > 0;
}

/**
 * Gets all sites for an organization.
 *
 * @param organizationId - Organization ID
 * @returns Array of sites
 */
export async function getSitesByOrganization(organizationId: string): Promise<Site[]> {
  const result = await query<SiteRow>(`
    SELECT id, pantheon_site_id, organization_id, name, workflow_settings, created_at, updated_at
    FROM app.sites
    WHERE organization_id = $1
    ORDER BY name ASC
  `, [organizationId]);

  return result.rows.map(mapRowToSite);
}

/**
 * Gets the organization for a site.
 *
 * @param siteId - Site ID
 * @returns The organization or null if site has no organization
 */
export async function getOrganizationForSite(siteId: string): Promise<Organization | null> {
  const result = await query<OrganizationRow>(`
    SELECT o.id, o.name, o.settings, o.created_at, o.updated_at, o.archived_at
    FROM app.organizations o
    INNER JOIN app.sites s ON s.organization_id = o.id
    WHERE s.id = $1
  `, [siteId]);

  if (result.rows.length === 0) {
    return null;
  }

  const siteOrgRow = result.rows[0];
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
 */
export async function getOrganizationsForUser(userId: string): Promise<Organization[]> {
  const result = await query<OrganizationRow>(`
    SELECT DISTINCT o.id, o.name, o.settings, o.created_at, o.updated_at, o.archived_at,
           o.external_space_id,
           -- Assumes each org has a single member (Phase 1). Revisit when org membership supports multiple users.
           (SELECT owner_u.email FROM app.organization_members owner_om
            JOIN app.users owner_u ON owner_u.id = owner_om.user_id
            WHERE owner_om.organization_id = o.id
            LIMIT 1) AS owner_email
    FROM app.organizations o
    WHERE o.archived_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM app.organization_members om
          WHERE om.organization_id = o.id AND om.user_id = $1::uuid
        )
        OR
        EXISTS (
          SELECT 1 FROM app.user_site_roles usr
          INNER JOIN app.users u ON u.id::text = usr.user_id
          INNER JOIN app.sites s ON s.id = usr.site_id
          WHERE u.id = $1::uuid AND s.organization_id = o.id AND s.archived_at IS NULL
        )
      )
  `, [userId]);

  return result.rows.map(mapRowToOrganization);
}

/**
 * Returns the user's primary organization ID from organization_members.
 * Returns null if the user has no direct membership.
 */
export async function getUserPrimaryOrg(userId: string): Promise<string | null> {
  const result = await query<{ organization_id: string }>(`
    SELECT organization_id FROM app.organization_members
    WHERE user_id = $1::uuid
    ORDER BY created_at ASC
    LIMIT 1
  `, [userId]);

  return result.rows[0]?.organization_id ?? null;
}

/**
 * Checks whether a user belongs to an organization — via direct membership
 * or via site roles on non-archived sites in that org.
 */
export async function isUserInOrganization(userId: string, organizationId: string): Promise<boolean> {
  const result = await query<{ found: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM app.organization_members om
      WHERE om.user_id = $1::uuid AND om.organization_id = $2::uuid
    ) OR EXISTS (
      SELECT 1 FROM app.user_site_roles usr
      INNER JOIN app.users u ON u.id::text = usr.user_id
      INNER JOIN app.sites s ON s.id = usr.site_id
      WHERE u.id = $1::uuid AND s.organization_id = $2::uuid AND s.archived_at IS NULL
    ) AS found
  `, [userId, organizationId]);

  return result.rows[0]?.found ?? false;
}

/**
 * Links an organization to a PCC space by setting external_space_id.
 * Optionally updates the org name to the PCC space name.
 * Only updates if the org's external_space_id is currently NULL.
 *
 * @returns true if linked, false if already linked or org not found
 */
export async function linkOrgToSpace(orgId: string, externalSpaceId: string, spaceName?: string): Promise<boolean> {
  const setClause = spaceName !== undefined && spaceName.trim() !== ''
    ? 'external_space_id = $2, name = $3, updated_at = NOW()'
    : 'external_space_id = $2, updated_at = NOW()';

  const params = spaceName !== undefined && spaceName.trim() !== ''
    ? [orgId, externalSpaceId, spaceName]
    : [orgId, externalSpaceId];

  const result = await query<{ id: string }>(`
    UPDATE app.organizations
    SET ${setClause}
    WHERE id = $1 AND external_space_id IS NULL
    RETURNING id
  `, params);

  return (result.rowCount ?? 0) > 0;
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
  await query('BEGIN');

  try {
    let orgName: string;

    if (spaceName !== undefined && spaceName.trim() !== '') {
      orgName = spaceName;
    } else {
      const baseName = deriveOrgNameFromEmail(email);
      const escapedBase = escapeLikePattern(baseName);
      const existing = await query<{ name: string }>(
        "SELECT name FROM app.organizations WHERE name = $1 OR name LIKE $2 ESCAPE '\\'",
        [baseName, escapedBase + ' %'],
      );

      if (existing.rows.length === 0) {
        orgName = baseName;
      } else {
        const existingNames = new Set(existing.rows.map((r) => r.name));
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

    const orgResult = await query<OrganizationRow>(`
      INSERT INTO app.organizations (name, settings, external_space_id)
      VALUES ($1, $2, $3)
      RETURNING id, name, settings, created_at, updated_at, archived_at, external_space_id
    `, [orgName, JSON.stringify(settings), externalSpaceId ?? null]);

    const orgRow = orgResult.rows[0];
    if (orgRow === undefined) {
      throw new Error('Failed to create organization: insert returned no row');
    }
    const org = mapRowToOrganization(orgRow);

    await query(`
      INSERT INTO app.organization_members (organization_id, user_id)
      VALUES ($1, $2::uuid)
    `, [org.id, userId]);

    await query('COMMIT');

    return org;
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}
