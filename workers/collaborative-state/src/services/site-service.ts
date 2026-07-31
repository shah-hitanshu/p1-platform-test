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
import { createMainBranch } from './branch-service';
import { createDocumentOnBranch } from './branch-document-service';
import { publishDocument } from './checkpoint-publish';
import { grantRole as grantAgentRole } from './agent-site-role-service';
import { grantRole as grantUserRole } from './user-site-role-service';
import { getFirstRow } from '../db/helpers';
import { requestSiteScreenshot, type ScreenshotProducerEnv } from '../queues/screenshot-producer';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new site.
 */
export interface CreateSiteParams {
  pantheonSiteId: string;
  name: string;
  url?: string;
  workflowSettings?: Partial<WorkflowSettings>;
  allowedOrigins?: string[];
  /** When provided, the creator is granted the appropriate site role based on createdByType. */
  creatorId?: string;
  /** Actor type. Controls which role table receives the creator grant. Defaults to 'user'. */
  createdByType?: 'user' | 'agent';
}

/**
 * Parameters for updating a site.
 *
 * `url: null` clears the column. `url: undefined` (or omitted) leaves it untouched.
 */
export interface UpdateSiteParams {
  name?: string;
  url?: string | null;
  workflowSettings?: Partial<WorkflowSettings>;
  allowedOrigins?: string[];
}

/**
 * Options for listing sites.
 */
export interface ListSitesOptions {
  limit?: number;
  offset?: number;
  /** The principal whose accessible sites to return. */
  principalId: string;
  /** Controls which role table to query. Defaults to 'user'. */
  principalType?: 'user' | 'agent';
  /**
   * When set on the agent path, intersects results with sites where this
   * user (referenced by app.users.id) also has a role. Prevents an agent
   * from leaking its full site list to an authenticated user that has
   * no access to those sites. Ignored on the user path. (PCC-3190)
   */
  actingUserId?: string;
  /**
   * Filter by archived status. true = archived only, false = active only,
   * undefined = active only (same as false, the safe default).
   */
  archived?: boolean;
}

/**
 * Database row format for sites.
 * workflow_settings can be returned as string or object depending on DB driver.
 */
interface SiteRow {
  id: string;
  pantheon_site_id: string;
  name: string;
  url: string | null;
  workflow_settings: WorkflowSettings | string;
  allowed_origins: string[] | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
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
 * Parses workflow settings from database.
 * Handles both string and object formats for JSONB columns.
 */
function parseWorkflowSettings(
  value: WorkflowSettings | string,
): WorkflowSettings {
  if (typeof value === 'string') {
    return JSON.parse(value) as WorkflowSettings;
  }
  return value;
}

/**
 * Maps a database row to a Site domain object.
 */
function mapRowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    pantheonSiteId: row.pantheon_site_id,
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
 * Validates a URL string. Only http(s) schemes are permitted.
 */
function assertValidUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidSiteParamsError(`url is not a valid URL: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidSiteParamsError(
      `url scheme not allowed: ${parsed.protocol} (must be http or https)`,
    );
  }
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

const DEFAULT_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

// =============================================================================
// Default root page content (Puck editor data)
// =============================================================================

const DEFAULT_ROOT_PAGE_SNAPSHOT: Record<string, unknown> = {
  root: { props: { title: 'Welcome to your new Pantheon P1 Site' } },
  content: [
    {
      type: 'P1WelcomeBlock',
      props: {
        id: 'seed-welcome',
        heading: 'Welcome to your new Pantheon P1 Site.',
        description: 'You just created this new site from Pantheon P1 starter kit, congrats! You\'ll need a Pantheon P1 user account to edit it and create new pages.',
        ctaLabel: 'Sign-in to P1',
        ctaHref: '/p1',
        footnote: 'Visit [P1 documentation](https://docs.pantheon.io) for more information.',
        loggedInHeading: 'Welcome to your new Pantheon P1 Site.',
        loggedInDescription: 'You just created this new site from Pantheon P1 starter kit, congrats! Start editing this page or visit the P1 dashboard to manage your site.',
        loggedInCtaLabel: 'Edit this page with P1 Visual Editor',
        loggedInCtaHref: '/p1',
        loggedInSecondaryLabel: 'Go to P1 Dashboard',
        loggedInFootnote: 'Visit [P1 documentation](https://docs.pantheon.io) for more information.',
        showLogo: true,
      },
    },
  ],
  zones: {},
};

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
export async function createSite(
  params: CreateSiteParams,
  env?: ScreenshotProducerEnv,
): Promise<Site> {
  // Validate required fields
  if (!params.pantheonSiteId || params.pantheonSiteId.trim() === '') {
    throw new InvalidSiteParamsError('pantheonSiteId is required');
  }
  if (!params.name || params.name.trim() === '') {
    throw new InvalidSiteParamsError('name is required');
  }
  if (params.url !== undefined) {
    assertValidUrl(params.url);
  }

  // Merge workflow settings with defaults
  const workflowSettings: WorkflowSettings = {
    ...DEFAULT_WORKFLOW_SETTINGS,
    ...params.workflowSettings,
  };

  await query('BEGIN');
  try {
    const result = await query<SiteRow>(
      `INSERT INTO app.sites (pantheon_site_id, name, url, workflow_settings, allowed_origins)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        params.pantheonSiteId,
        params.name,
        params.url ?? null,
        JSON.stringify(workflowSettings),
        params.allowedOrigins ?? [],
      ],
    );

    const site = mapRowToSite(getFirstRow(result.rows));

    if (params.creatorId !== undefined) {
      if (params.createdByType === 'agent') {
        await grantAgentRole({
          agentId: params.creatorId,
          siteId: site.id,
          role: 'admin',
          grantedBy: params.creatorId,
        });
      } else {
        await grantUserRole({
          userId: params.creatorId,
          siteId: site.id,
          role: 'owner',
          grantedBy: params.creatorId,
        });
      }
    }

    // Create the main branch for the site
    const mainBranch = await createMainBranch({
      siteId: site.id,
      createdById: params.creatorId ?? DEFAULT_SYSTEM_USER_ID,
      createdByType: params.createdByType ?? 'user',
    });

    await query('COMMIT');

    // Seed a default root page so the site has content immediately.
    // Runs after commit — failure here does not roll back site creation.
    try {
      const createdById = params.creatorId ?? DEFAULT_SYSTEM_USER_ID;
      const createdByType = params.createdByType ?? 'user';
      const { document: rootDoc } = await createDocumentOnBranch({
        siteId: site.id,
        branchId: mainBranch.id,
        path: '/',
        snapshot: DEFAULT_ROOT_PAGE_SNAPSHOT,
        createdById,
        createdByType,
      });
      await publishDocument({
        siteId: site.id,
        branchId: mainBranch.id,
        documentId: rootDoc.id,
        createdById,
        createdByType: createdByType === 'agent' ? 'agent' : 'user',
      });
    } catch (seedErr) {
      console.warn(
        '[site-service] Failed to seed root page for site %s: %s',
        site.id,
        seedErr instanceof Error ? seedErr.message : String(seedErr),
      );
    }

    if (env !== undefined && site.url !== undefined && site.url !== '') {
      await requestSiteScreenshot(env, site, 'url_changed');
    }

    return site;
  } catch (error) {
    await query('ROLLBACK');
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
  const result = await query<SiteRow>('SELECT * FROM app.sites WHERE id = $1', [
    siteId,
  ]);

  if (result.rows.length === 0) {
    return null;
  }

  const siteRow = result.rows[0];
  if (!siteRow) {
    return null;
  }
  return mapRowToSite(siteRow);
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

  const pantheonRow = result.rows[0];
  if (!pantheonRow) {
    return null;
  }
  return mapRowToSite(pantheonRow);
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
  env?: ScreenshotProducerEnv,
): Promise<Site | null> {
  const urlProvided = 'url' in updates;
  const urlValue: string | null = updates.url ?? null;
  if (urlProvided && urlValue !== null) {
    assertValidUrl(urlValue);
  }

  const wantUrlChangeDetection = env !== undefined && urlProvided;
  let priorUrl: string | undefined;

  if (updates.workflowSettings) {
    const existing = await getSite(siteId);
    if (!existing) {
      return null;
    }

    if (wantUrlChangeDetection) {
      priorUrl = existing.url;
    }

    const mergedSettings: WorkflowSettings = {
      ...existing.workflowSettings,
      ...updates.workflowSettings,
    };

    const result = await query<SiteRow>(
      `UPDATE app.sites
       SET name = COALESCE($1, name),
           url = CASE WHEN $2::boolean THEN $3 ELSE url END,
           workflow_settings = $4,
           allowed_origins = COALESCE($5::text[], allowed_origins),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        updates.name ?? null,
        urlProvided,
        urlValue,
        JSON.stringify(mergedSettings),
        updates.allowedOrigins ?? null,
        siteId,
      ],
    );

    const updatedRow1 = result.rows[0];
    if (!updatedRow1) {
      return null;
    }

    const updated = mapRowToSite(updatedRow1);
    await maybeEnqueueOnUrlChange(env, updated, priorUrl);
    return updated;
  }

  if (wantUrlChangeDetection) {
    const existing = await getSite(siteId);
    priorUrl = existing?.url;
  }

  const result = await query<SiteRow>(
    `UPDATE app.sites
     SET name = COALESCE($1, name),
         url = CASE WHEN $2::boolean THEN $3 ELSE url END,
         allowed_origins = COALESCE($4::text[], allowed_origins),
         updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [
      updates.name ?? null,
      urlProvided,
      urlValue,
      updates.allowedOrigins ?? null,
      siteId,
    ],
  );

  const updatedRow2 = result.rows[0];
  if (!updatedRow2) {
    return null;
  }

  const updated = mapRowToSite(updatedRow2);
  await maybeEnqueueOnUrlChange(env, updated, priorUrl);
  return updated;
}

async function maybeEnqueueOnUrlChange(
  env: ScreenshotProducerEnv | undefined,
  updated: Site,
  priorUrl: string | undefined,
): Promise<void> {
  if (env === undefined) return;
  if (updated.url === undefined || updated.url === '') return;
  if (updated.url === priorUrl) return;
  await requestSiteScreenshot(env, updated, 'url_changed');
}

/**
 * Deletes a site and all related data.
 *
 * This cascades to delete all branches, documents, and associated data.
 *
 * @param siteId - The site ID
 * @returns True if deleted, false if not found
 */
export async function deleteSite(siteId: string): Promise<boolean> {
  // First check if site exists
  const site = await getSite(siteId);
  if (!site) {
    return false;
  }

  // Get all branch IDs for this site
  const branchResult = await query<{ id: string }>(
    'SELECT id FROM app.branches WHERE site_id = $1',
    [siteId],
  );
  const branchIds = branchResult.rows.map((r) => r.id);

  if (branchIds.length > 0) {
    // Delete merge requests referencing any of these branches
    await query(
      `DELETE FROM app.merge_requests
       WHERE source_branch_id = ANY($1::uuid[]) OR target_branch_id = ANY($1::uuid[])`,
      [branchIds],
    );

    // Delete branch document metadata
    await query(
      'DELETE FROM app.branch_document_metadata WHERE branch_id = ANY($1::uuid[])',
      [branchIds],
    );

    // Delete branch structure state
    await query(
      'DELETE FROM app.branch_structure_state WHERE branch_id = ANY($1::uuid[])',
      [branchIds],
    );

    // Clear source_checkpoint_id on branches before deleting checkpoints
    // (branches.source_checkpoint_id references checkpoints)
    await query(
      'UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id = $1',
      [siteId],
    );

    // Clear base_checkpoint_id on merge_requests before deleting checkpoints
    // (merge_requests.base_checkpoint_id references checkpoints)
    await query(
      'UPDATE app.merge_requests SET base_checkpoint_id = NULL WHERE site_id = $1',
      [siteId],
    );

    // Delete checkpoint related data for checkpoints on these branches
    await query(
      `DELETE FROM app.checkpoint_documents
       WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = ANY($1::uuid[]))`,
      [branchIds],
    );

    await query(
      `DELETE FROM app.checkpoint_structures
       WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = ANY($1::uuid[]))`,
      [branchIds],
    );

    await query(
      `DELETE FROM app.checkpoint_document_metadata
       WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = ANY($1::uuid[]))`,
      [branchIds],
    );

    // Delete checkpoints
    await query(
      'DELETE FROM app.checkpoints WHERE branch_id = ANY($1::uuid[])',
      [branchIds],
    );

    // Delete document versions
    await query(
      'DELETE FROM app.document_versions WHERE branch_id = ANY($1::uuid[])',
      [branchIds],
    );

    // Delete branches (branch_grants and guest_links have ON DELETE CASCADE)
    await query('DELETE FROM app.branches WHERE site_id = $1', [siteId]);
  }

  // Get all structure IDs for this site
  const structureResult = await query<{ id: string }>(
    'SELECT id FROM app.site_structures WHERE site_id = $1',
    [siteId],
  );
  const structureIds = structureResult.rows.map((r) => r.id);

  if (structureIds.length > 0) {
    // Delete structure nodes (they reference both site_structures and documents)
    await query(
      'DELETE FROM app.structure_nodes WHERE structure_id = ANY($1::uuid[])',
      [structureIds],
    );
  }

  // Delete site structures
  await query('DELETE FROM app.site_structures WHERE site_id = $1', [siteId]);

  // Delete documents
  await query('DELETE FROM app.documents WHERE site_id = $1', [siteId]);

  // Finally delete the site
  const result = await query('DELETE FROM app.sites WHERE id = $1', [siteId]);

  return (result.rowCount ?? 0) > 0;
}

/**
 * Soft-deletes a site by setting archived_at. Cascades to non-archived branches
 * and documents using the same transaction timestamp so restore can precisely undo
 * only the cascade (not independently-archived rows).
 * Returns false if the site does not exist, 'already_archived' if already soft-deleted.
 */
export async function archiveSite(siteId: string): Promise<boolean | 'already_archived'> {
  await query('BEGIN');
  try {
    const result = await query<{ archived_at: string }>(
      `UPDATE app.sites SET archived_at = NOW()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING archived_at`,
      [siteId],
    );
    if ((result.rowCount ?? 0) === 0) {
      // Distinguish not-found vs already-archived
      const exists = await query<{ id: string }>(
        'SELECT id FROM app.sites WHERE id = $1',
        [siteId],
      );
      await query('COMMIT');
      return exists.rows.length > 0 ? 'already_archived' : false;
    }
    const archiveRow = result.rows[0];
    if (!archiveRow) {
      await query('COMMIT');
      return false;
    }
    const archiveTs = archiveRow.archived_at;
    await query(
      'UPDATE app.branches SET archived_at = $1 WHERE site_id = $2 AND archived_at IS NULL',
      [archiveTs, siteId],
    );
    await query(
      'UPDATE app.documents SET archived_at = $1 WHERE site_id = $2 AND archived_at IS NULL',
      [archiveTs, siteId],
    );
    await query('COMMIT');
    return true;
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

/**
 * Restores a soft-deleted site. Clears archived_at on the site and on any
 * branches/documents that share the exact cascade timestamp, leaving
 * independently-archived rows untouched.
 * Returns the restored Site, or null if not found or not archived.
 */
export async function restoreSite(siteId: string): Promise<Site | null> {
  const selectResult = await query<SiteRow>(
    'SELECT * FROM app.sites WHERE id = $1',
    [siteId],
  );
  const row = selectResult.rows[0];
  if (row?.archived_at == null) {
    return null;
  }
  const archiveTs = row.archived_at;
  await query('BEGIN');
  try {
    const updateResult = await query<SiteRow>(
      'UPDATE app.sites SET archived_at = NULL WHERE id = $1 RETURNING *',
      [siteId],
    );
    if (updateResult.rows.length === 0) {
      await query('COMMIT');
      return null;
    }
    await query(
      'UPDATE app.branches SET archived_at = NULL WHERE site_id = $1 AND archived_at = $2',
      [siteId, archiveTs],
    );
    await query(
      'UPDATE app.documents SET archived_at = NULL WHERE site_id = $1 AND archived_at = $2',
      [siteId, archiveTs],
    );
    await query('COMMIT');
    const restoredRow = updateResult.rows[0];
    if (!restoredRow) {
      return null;
    }
    return mapRowToSite(restoredRow);
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

/**
 * Lists sites the given principal has access to, with optional pagination.
 */
export async function listSites(options: ListSitesOptions): Promise<Site[]> {
  const { limit, offset, principalId, principalType, actingUserId, archived } = options;
  const params: unknown[] = [principalId];

  const archivedFilter = archived === true ? ' AND s.archived_at IS NOT NULL' : ' AND s.archived_at IS NULL';

  let sql: string;
  if (principalType === 'agent') {
    // PCC-3190: when an agent acts on behalf of a user, intersect with
    // the user's site roles so the result never leaks beyond what the
    // acting user could see directly. The revoked_at filter on the agent
    // grant must remain in either branch.
    if (actingUserId !== undefined) {
      params.push(actingUserId);
      sql =
        'SELECT DISTINCT s.* FROM app.sites s' +
        ' INNER JOIN app.agent_site_roles asr ON asr.site_id = s.id' +
        ' INNER JOIN app.user_site_roles usr ON usr.site_id = s.id' +
        ' WHERE asr.agent_id = $1 AND asr.revoked_at IS NULL' +
        ' AND usr.user_id = $2' +
        archivedFilter +
        ' ORDER BY s.created_at DESC';
    } else {
      sql =
        'SELECT DISTINCT s.* FROM app.sites s' +
        ' INNER JOIN app.agent_site_roles asr ON asr.site_id = s.id' +
        ' WHERE asr.agent_id = $1 AND asr.revoked_at IS NULL' +
        archivedFilter +
        ' ORDER BY s.created_at DESC';
    }
  } else {
    sql =
      'SELECT DISTINCT s.* FROM app.sites s' +
      ' INNER JOIN app.user_site_roles usr ON usr.site_id = s.id' +
      ' WHERE usr.user_id = $1' +
      archivedFilter +
      ' ORDER BY s.created_at DESC';
  }

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

/**
 * Retrieves allowed origins for a site (for OAuth redirect URI validation).
 * Returns null when the site does not exist, empty array when origins not configured.
 */
export async function getSiteAllowedOrigins(
  siteId: string,
): Promise<string[] | null> {
  const result = await query<{ allowed_origins: string[] | null }>(
    'SELECT allowed_origins FROM app.sites WHERE id = $1',
    [siteId],
  );
  const originsRow = result.rows[0];
  if (!originsRow) {
    return null;
  }
  return originsRow.allowed_origins ?? [];
}

// Module-scope cache: Worker isolates are reused across requests so this
// persists within a single isolate, eliminating repeated DB queries for
// the same site. Entries expire after 5 minutes; a site that updates its
// allowed_origins will see the change reflected within that window.
const _allowedOriginsCache = new Map<string, { origins: string[]; expiresAt: number }>();
const ALLOWED_ORIGINS_TTL_MS = 5 * 60 * 1000;

/**
 * Cached variant of getSiteAllowedOrigins.
 * Use this on hot request paths (CORS enforcement) to avoid a DB round-trip
 * on every API call. Falls through to the DB on a cache miss or expiry.
 */
export async function getCachedSiteAllowedOrigins(
  siteId: string,
): Promise<string[] | null> {
  const now = Date.now();
  const cached = _allowedOriginsCache.get(siteId);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.origins;
  }
  const origins = await getSiteAllowedOrigins(siteId);
  if (origins !== null) {
    _allowedOriginsCache.set(siteId, { origins, expiresAt: now + ALLOWED_ORIGINS_TTL_MS });
  }
  return origins;
}
