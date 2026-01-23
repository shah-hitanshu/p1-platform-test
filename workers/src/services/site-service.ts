/**
 * Phase 3.1: Site Service
 *
 * CRUD operations for Sites.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Sites"
 */

import type { Site, WorkflowSettings } from '../types';
import { query } from '../db';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new site.
 */
export interface CreateSiteParams {
  pantheonSiteId: string;
  name: string;
  workflowSettings?: Partial<WorkflowSettings>;
}

/**
 * Parameters for updating a site.
 */
export interface UpdateSiteParams {
  name?: string;
  workflowSettings?: Partial<WorkflowSettings>;
}

/**
 * Options for listing sites.
 */
export interface ListSitesOptions {
  limit?: number;
  offset?: number;
}

/**
 * Database row format for sites.
 */
interface SiteRow {
  id: string;
  pantheon_site_id: string;
  name: string;
  workflow_settings: WorkflowSettings;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when attempting to create a site with a duplicate Pantheon site ID.
 */
export class DuplicatePantheonSiteIdError extends Error {
  public readonly name = 'DuplicatePantheonSiteIdError';

  constructor(public readonly pantheonSiteId: string) {
    super(`A site with Pantheon site ID "${pantheonSiteId}" already exists.`);
    Object.setPrototypeOf(this, DuplicatePantheonSiteIdError.prototype);
  }
}

/**
 * Error thrown when site creation parameters are invalid.
 */
export class InvalidSiteParamsError extends Error {
  public readonly name = 'InvalidSiteParamsError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidSiteParamsError.prototype);
  }
}

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default workflow settings as defined in the database schema.
 */
const DEFAULT_WORKFLOW_SETTINGS: WorkflowSettings = {
  mergeApprovalMode: 'optional',
  minApprovers: 1,
  allowSelfApproval: true,
  approverMode: 'both',
  approverMinRole: 'EDITOR',
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Maps a database row to a Site domain object.
 */
function mapRowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    pantheonSiteId: row.pantheon_site_id,
    name: row.name,
    workflowSettings: row.workflow_settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23505'
  );
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Creates a new site.
 *
 * @param params - Site creation parameters
 * @returns The created site
 * @throws DuplicatePantheonSiteIdError if pantheonSiteId already exists
 * @throws InvalidSiteParamsError if required fields are missing
 */
export async function createSite(params: CreateSiteParams): Promise<Site> {
  // Validate required fields
  if (!params.pantheonSiteId || params.pantheonSiteId.trim() === '') {
    throw new InvalidSiteParamsError('pantheonSiteId is required');
  }
  if (!params.name || params.name.trim() === '') {
    throw new InvalidSiteParamsError('name is required');
  }

  // Merge workflow settings with defaults
  const workflowSettings: WorkflowSettings = {
    ...DEFAULT_WORKFLOW_SETTINGS,
    ...params.workflowSettings,
  };

  try {
    const result = await query<SiteRow>(
      `INSERT INTO app.sites (pantheon_site_id, name, workflow_settings)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [params.pantheonSiteId, params.name, JSON.stringify(workflowSettings)],
    );

    return mapRowToSite(result.rows[0]);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicatePantheonSiteIdError(params.pantheonSiteId);
    }
    throw error;
  }
}

/**
 * Retrieves a site by its ID.
 *
 * @param siteId - The site ID
 * @returns The site or null if not found
 */
export async function getSite(siteId: string): Promise<Site | null> {
  const result = await query<SiteRow>(
    'SELECT * FROM app.sites WHERE id = $1',
    [siteId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToSite(result.rows[0]);
}

/**
 * Retrieves a site by its Pantheon site ID.
 *
 * @param pantheonSiteId - The Pantheon site ID
 * @returns The site or null if not found
 */
export async function getSiteByPantheonId(
  pantheonSiteId: string,
): Promise<Site | null> {
  const result = await query<SiteRow>(
    'SELECT * FROM app.sites WHERE pantheon_site_id = $1',
    [pantheonSiteId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToSite(result.rows[0]);
}

/**
 * Updates a site.
 *
 * @param siteId - The site ID
 * @param updates - Fields to update
 * @returns The updated site or null if not found
 */
export async function updateSite(
  siteId: string,
  updates: UpdateSiteParams,
): Promise<Site | null> {
  // If updating workflow settings, we need to merge with existing
  if (updates.workflowSettings) {
    const existing = await getSite(siteId);
    if (!existing) {
      return null;
    }

    const mergedSettings: WorkflowSettings = {
      ...existing.workflowSettings,
      ...updates.workflowSettings,
    };

    const result = await query<SiteRow>(
      `UPDATE app.sites
       SET name = COALESCE($1, name),
           workflow_settings = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [updates.name ?? null, JSON.stringify(mergedSettings), siteId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRowToSite(result.rows[0]);
  }

  // Simple update without workflow settings
  const result = await query<SiteRow>(
    `UPDATE app.sites
     SET name = COALESCE($1, name),
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [updates.name ?? null, siteId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToSite(result.rows[0]);
}

/**
 * Deletes a site.
 *
 * @param siteId - The site ID
 * @returns True if deleted, false if not found
 */
export async function deleteSite(siteId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM app.sites WHERE id = $1',
    [siteId],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Lists all sites with optional pagination.
 *
 * @param options - Pagination options
 * @returns Array of sites
 */
export async function listSites(options: ListSitesOptions = {}): Promise<Site[]> {
  const { limit, offset } = options;

  let sql = 'SELECT * FROM app.sites ORDER BY created_at DESC';
  const params: unknown[] = [];

  if (limit !== undefined) {
    params.push(limit);
    sql += ' LIMIT $' + String(params.length);
  }

  if (offset !== undefined) {
    params.push(offset);
    sql += ' OFFSET $' + String(params.length);
  }

  const result = await query<SiteRow>(sql, params);

  return result.rows.map(mapRowToSite);
}
