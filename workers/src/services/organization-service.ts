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
}

/**
 * Database row format for sites with organization.
 */
interface SiteRow {
  id: string;
  pantheon_site_id: string;
  organization_id: string | null;
  name: string;
  workflow_settings: WorkflowSettings | string;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when organization creation or update parameters are invalid.
 */
export class InvalidOrganizationParamsError extends Error {
  public readonly name = 'InvalidOrganizationParamsError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidOrganizationParamsError.prototype);
  }
}

/**
 * Error thrown when attempting to delete an organization that has linked sites.
 */
export class OrganizationHasSitesError extends Error {
  public readonly name = 'OrganizationHasSitesError';

  constructor(public readonly organizationId: string) {
    super(`Cannot delete organization "${organizationId}" because it has linked sites.`);
    Object.setPrototypeOf(this, OrganizationHasSitesError.prototype);
  }
}

/**
 * Error thrown when attempting to link a site to a non-existent organization.
 */
export class OrganizationNotFoundError extends Error {
  public readonly name = 'OrganizationNotFoundError';

  constructor(public readonly organizationId: string) {
    super(`Organization "${organizationId}" not found.`);
    Object.setPrototypeOf(this, OrganizationNotFoundError.prototype);
  }
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
  };
}

/**
 * Maps a database row to a Site domain object.
 */
function mapRowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    pantheonSiteId: row.pantheon_site_id,
    organizationId: row.organization_id ?? undefined,
    name: row.name,
    workflowSettings: parseWorkflowSettings(row.workflow_settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    RETURNING id, name, settings, created_at, updated_at
  `, [params.name, JSON.stringify(settings)]);

  return mapRowToOrganization(result.rows[0]);
}

/**
 * Gets an organization by ID.
 *
 * @param id - Organization ID
 * @returns The organization or null if not found
 */
export async function getOrganizationById(id: string): Promise<Organization | null> {
  const result = await query<OrganizationRow>(`
    SELECT id, name, settings, created_at, updated_at
    FROM app.organizations
    WHERE id = $1
  `, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToOrganization(result.rows[0]);
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
    RETURNING id, name, settings, created_at, updated_at
  `, values);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToOrganization(result.rows[0]);
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
 * Lists all organizations with optional pagination.
 *
 * @param options - Pagination options
 * @returns Array of organizations
 */
export async function listOrganizations(
  options: ListOrganizationsOptions = {},
): Promise<Organization[]> {
  const { limit = 100, offset = 0 } = options;

  const result = await query<OrganizationRow>(`
    SELECT id, name, settings, created_at, updated_at
    FROM app.organizations
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
    SELECT o.id, o.name, o.settings, o.created_at, o.updated_at
    FROM app.organizations o
    INNER JOIN app.sites s ON s.organization_id = o.id
    WHERE s.id = $1
  `, [siteId]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToOrganization(result.rows[0]);
}
