/**
 * Phase 3.1: Site Service
 *
 * CRUD operations for Sites.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Sites"
 */

import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull, or, sql, type InferSelectModel } from 'drizzle-orm';
import type { PgSelect } from 'drizzle-orm/pg-core';
import type { Site, WorkflowSettings } from '../types';
import { driverErrorCode } from '../db/driver-error';
import { toIsoTimestamp } from '../db/helpers';
import { db, transaction } from '../db/scope';
import {
  agentSiteRoles,
  branchDocumentMetadata,
  branchDocumentPaths,
  branchStructureState,
  branches,
  checkpointDocumentMetadata,
  checkpointDocuments,
  checkpointStructures,
  checkpoints,
  documentVersions,
  documents,
  mergeRequests,
  siteStructures,
  sites,
  structureNodes,
  userSiteRoles,
  users,
} from '../db/schema';
import { createMainBranch, clearBranchCache } from './branch-service';
import { createDocumentOnBranch } from './branch-document-service';
import { publishDocument } from './checkpoint-publish';
import { grantRole as grantAgentRole, isGlobalAgentId } from './agent-site-role-service';
import { grantRole as grantUserRole } from './user-site-role-service';
import { getFirstRow } from '../db/helpers';
import { requestSiteScreenshot, type ScreenshotProducerEnv } from '../queues/screenshot-producer';
import { DuplicatePantheonSiteIdError, InvalidSiteParamsError } from './errors';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new site.
 */
export interface CreateSiteParams {
  pantheonSiteId?: string;
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
 * For `url` and `pantheonSiteId`, null clears the column and undefined (or
 * omitted) leaves it untouched.
 */
export interface UpdateSiteParams {
  name?: string;
  url?: string | null;
  pantheonSiteId?: string | null;
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
  /** Filter sites to a specific organization. */
  organizationId?: string;
  /**
   * Return every site in `organizationId` rather than only those the principal
   * holds a role on. Set by the caller that already authorized the principal
   * for the whole organization; ignored without an `organizationId`.
   */
  includeAllOrgSites?: boolean;
}

/** A site row as the schema declares it. */
type SiteRow = InferSelectModel<typeof sites>;

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
function parseWorkflowSettings(value: unknown): WorkflowSettings {
  if (typeof value === 'string') {
    return JSON.parse(value) as WorkflowSettings;
  }
  return value as WorkflowSettings;
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
    allowedOrigins: row.allowedOrigins,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    archivedAt: row.archivedAt === null ? null : toIsoTimestamp(row.archivedAt),
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
 * Normalizes a Pantheon site ID input: blank or missing becomes null.
 */
function normalizePantheonSiteId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return driverErrorCode(error) === '23505';
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
        description:
          "You just created this new site from Pantheon P1 starter kit, congrats! You'll need a Pantheon P1 user account to edit it and create new pages.",
        ctaLabel: 'Sign-in to P1',
        ctaHref: '/p1',
        footnote: 'Visit [P1 documentation](https://docs.pantheon.io) for more information.',
        loggedInHeading: 'Welcome to your new Pantheon P1 Site.',
        loggedInDescription:
          'You just created this new site from Pantheon P1 starter kit, congrats! Start editing this page or visit the P1 dashboard to manage your site.',
        loggedInCtaLabel: 'Edit this page with P1 Visual Editor',
        loggedInCtaHref: '/p1',
        loggedInSecondaryLabel: 'Go to P1 Dashboard',
        loggedInFootnote:
          'Visit [P1 documentation](https://docs.pantheon.io) for more information.',
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
  if (!params.name || params.name.trim() === '') {
    throw new InvalidSiteParamsError('name is required');
  }
  const pantheonSiteId = normalizePantheonSiteId(params.pantheonSiteId);
  if (params.url !== undefined) {
    assertValidUrl(params.url);
  }

  // Merge workflow settings with defaults
  const workflowSettings: WorkflowSettings = {
    ...DEFAULT_WORKFLOW_SETTINGS,
    ...params.workflowSettings,
  };

  try {
    const { site, mainBranch } = await transaction(async () => {
      const inserted = await db()
        .insert(sites)
        .values({
          pantheonSiteId,
          name: params.name,
          url: params.url ?? null,
          workflowSettings,
          allowedOrigins: params.allowedOrigins ?? [],
        })
        .returning();

      const created = mapRowToSite(getFirstRow(inserted));

      if (params.creatorId !== undefined) {
        if (params.createdByType === 'agent') {
          await grantAgentRole({
            agentId: params.creatorId,
            siteId: created.id,
            role: 'admin',
            grantedBy: params.creatorId,
          });
        } else {
          await grantUserRole({
            userId: params.creatorId,
            siteId: created.id,
            role: 'owner',
            grantedBy: params.creatorId,
          });
        }
      }

      // Create the main branch for the site
      const branch = await createMainBranch({
        siteId: created.id,
        createdById: params.creatorId ?? DEFAULT_SYSTEM_USER_ID,
        createdByType: params.createdByType ?? 'user',
      });

      return { site: created, mainBranch: branch };
    });

    // createMainBranch cleared the cache before this commit; a lookup in that
    // window could have cached a negative for the new site's main branch, so
    // clear again now that the row is committed.
    clearBranchCache();

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
    if (isUniqueConstraintViolation(error) && pantheonSiteId !== null) {
      throw new DuplicatePantheonSiteIdError(pantheonSiteId);
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
  const [siteRow] = await db().select().from(sites).where(eq(sites.id, siteId));

  return siteRow === undefined ? null : mapRowToSite(siteRow);
}

/**
 * Retrieves a site by its Pantheon site ID.
 *
 * @param pantheonSiteId - The Pantheon site ID
 * @returns The site or null if not found
 */
export async function getSiteByPantheonId(pantheonSiteId: string): Promise<Site | null> {
  const [pantheonRow] = await db()
    .select()
    .from(sites)
    .where(eq(sites.pantheonSiteId, pantheonSiteId));

  return pantheonRow === undefined ? null : mapRowToSite(pantheonRow);
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

  const pantheonSiteIdProvided = 'pantheonSiteId' in updates;
  const pantheonSiteIdValue = normalizePantheonSiteId(updates.pantheonSiteId);

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

    const result = await runSiteUpdate(
      siteId,
      {
        ...(updates.name === undefined ? {} : { name: updates.name }),
        ...(urlProvided ? { url: urlValue } : {}),
        ...(pantheonSiteIdProvided ? { pantheonSiteId: pantheonSiteIdValue } : {}),
        workflowSettings: mergedSettings,
        ...(updates.allowedOrigins === undefined ? {} : { allowedOrigins: updates.allowedOrigins }),
      },
      pantheonSiteIdValue,
    );

    const updatedRow1 = result[0];
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

  const result = await runSiteUpdate(
    siteId,
    {
      ...(updates.name === undefined ? {} : { name: updates.name }),
      ...(urlProvided ? { url: urlValue } : {}),
      ...(pantheonSiteIdProvided ? { pantheonSiteId: pantheonSiteIdValue } : {}),
      ...(updates.allowedOrigins === undefined ? {} : { allowedOrigins: updates.allowedOrigins }),
    },
    pantheonSiteIdValue,
  );

  const updatedRow2 = result[0];
  if (!updatedRow2) {
    return null;
  }

  const updated = mapRowToSite(updatedRow2);
  await maybeEnqueueOnUrlChange(env, updated, priorUrl);
  return updated;
}

// Runs an update that may touch pantheon_site_id, translating its
// unique-constraint violation into the domain error the routes map to a 409.
// A column the caller left out keeps the value it has.
async function runSiteUpdate(
  siteId: string,
  values: Partial<Omit<SiteRow, 'id'>>,
  pantheonSiteIdValue: string | null,
): Promise<SiteRow[]> {
  try {
    return await db()
      .update(sites)
      .set({ ...values, updatedAt: sql`NOW()` })
      .where(eq(sites.id, siteId))
      .returning();
  } catch (error) {
    if (isUniqueConstraintViolation(error) && pantheonSiteIdValue !== null) {
      throw new DuplicatePantheonSiteIdError(pantheonSiteIdValue);
    }
    throw error;
  }
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
  const branchRows = await db()
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.siteId, siteId));
  const branchIds = branchRows.map((r) => r.id);

  if (branchIds.length > 0) {
    const checkpointsOnBranches = db()
      .select({ id: checkpoints.id })
      .from(checkpoints)
      .where(inArray(checkpoints.branchId, branchIds));

    // Delete merge requests referencing any of these branches
    await db()
      .delete(mergeRequests)
      .where(
        or(
          inArray(mergeRequests.sourceBranchId, branchIds),
          inArray(mergeRequests.targetBranchId, branchIds),
        ),
      );

    await db().delete(branchDocumentPaths).where(inArray(branchDocumentPaths.branchId, branchIds));

    // Delete branch document metadata
    await db()
      .delete(branchDocumentMetadata)
      .where(inArray(branchDocumentMetadata.branchId, branchIds));

    // Delete branch structure state
    await db()
      .delete(branchStructureState)
      .where(inArray(branchStructureState.branchId, branchIds));

    // Clear source_checkpoint_id on branches before deleting checkpoints
    // (branches.source_checkpoint_id references checkpoints)
    await db()
      .update(branches)
      .set({ sourceCheckpointId: null })
      .where(eq(branches.siteId, siteId));

    // Clear base_checkpoint_id on merge_requests before deleting checkpoints
    // (merge_requests.base_checkpoint_id references checkpoints)
    await db()
      .update(mergeRequests)
      .set({ baseCheckpointId: null })
      .where(eq(mergeRequests.siteId, siteId));

    // Delete checkpoint related data for checkpoints on these branches
    await db()
      .delete(checkpointDocuments)
      .where(inArray(checkpointDocuments.checkpointId, checkpointsOnBranches));

    await db()
      .delete(checkpointStructures)
      .where(inArray(checkpointStructures.checkpointId, checkpointsOnBranches));

    await db()
      .delete(checkpointDocumentMetadata)
      .where(inArray(checkpointDocumentMetadata.checkpointId, checkpointsOnBranches));

    // Delete checkpoints
    await db().delete(checkpoints).where(inArray(checkpoints.branchId, branchIds));

    // Delete document versions
    await db().delete(documentVersions).where(inArray(documentVersions.branchId, branchIds));

    // Delete branches (branch_grants and guest_links have ON DELETE CASCADE)
    await db().delete(branches).where(eq(branches.siteId, siteId));
    clearBranchCache();
  }

  // Get all structure IDs for this site
  const structureRows = await db()
    .select({ id: siteStructures.id })
    .from(siteStructures)
    .where(eq(siteStructures.siteId, siteId));
  const structureIds = structureRows.map((r) => r.id);

  if (structureIds.length > 0) {
    // Delete structure nodes (they reference both site_structures and documents)
    await db().delete(structureNodes).where(inArray(structureNodes.structureId, structureIds));
  }

  // Delete site structures
  await db().delete(siteStructures).where(eq(siteStructures.siteId, siteId));

  // Delete documents
  await db().delete(documents).where(eq(documents.siteId, siteId));

  // Finally delete the site
  const deleted = await db().delete(sites).where(eq(sites.id, siteId)).returning({ id: sites.id });

  return deleted.length > 0;
}

/**
 * Soft-deletes a site by setting archived_at. Cascades to non-archived branches
 * and documents using the same transaction timestamp so restore can precisely undo
 * only the cascade (not independently-archived rows).
 * Returns false if the site does not exist, 'already_archived' if already soft-deleted.
 */
export async function archiveSite(siteId: string): Promise<boolean | 'already_archived'> {
  const outcome = await transaction(async () => {
    const [archiveRow] = await db()
      .update(sites)
      .set({ archivedAt: sql`NOW()` })
      .where(and(eq(sites.id, siteId), isNull(sites.archivedAt)))
      .returning({ archivedAt: sites.archivedAt });

    if (archiveRow?.archivedAt == null) {
      // Distinguish not-found vs already-archived
      const exists = await db().select({ id: sites.id }).from(sites).where(eq(sites.id, siteId));
      return exists.length > 0 ? 'already_archived' : false;
    }

    const archiveTs = archiveRow.archivedAt;
    await db()
      .update(branches)
      .set({ archivedAt: archiveTs })
      .where(and(eq(branches.siteId, siteId), isNull(branches.archivedAt)));
    await db()
      .update(documents)
      .set({ archivedAt: archiveTs })
      .where(and(eq(documents.siteId, siteId), isNull(documents.archivedAt)));
    return true;
  });

  if (outcome === true) {
    clearBranchCache();
  }
  return outcome;
}

/**
 * Restores a soft-deleted site. Clears archived_at on the site and on any
 * branches/documents that share the exact cascade timestamp, leaving
 * independently-archived rows untouched.
 * Returns the restored Site, or null if not found or not archived.
 */
export async function restoreSite(siteId: string): Promise<Site | null> {
  const [row] = await db().select().from(sites).where(eq(sites.id, siteId));
  if (row?.archivedAt == null) {
    return null;
  }
  const archiveTs = row.archivedAt;

  const restoredRow = await transaction(async () => {
    const [restored] = await db()
      .update(sites)
      .set({ archivedAt: null })
      .where(eq(sites.id, siteId))
      .returning();
    if (restored === undefined) {
      return undefined;
    }
    await db()
      .update(branches)
      .set({ archivedAt: null })
      .where(and(eq(branches.siteId, siteId), eq(branches.archivedAt, archiveTs)));
    await db()
      .update(documents)
      .set({ archivedAt: null })
      .where(and(eq(documents.siteId, siteId), eq(documents.archivedAt, archiveTs)));
    return restored;
  });

  if (restoredRow === undefined) {
    return null;
  }
  clearBranchCache();
  return mapRowToSite(restoredRow);
}

/**
 * Lists sites the given principal has access to, with optional pagination.
 */
export async function listSites(options: ListSitesOptions): Promise<Site[]> {
  const {
    limit,
    offset,
    principalId,
    principalType,
    actingUserId,
    archived,
    organizationId,
    includeAllOrgSites,
  } = options;
  const archivedFilter = archived === true ? isNotNull(sites.archivedAt) : isNull(sites.archivedAt);
  const orgFilter = organizationId === undefined ? undefined : eq(sites.organizationId, organizationId);

  /**
   * Applies the paging every listing shares. Each of them projects the sites
   * table, which is what $dynamic() erases from the type.
   */
  const paged = async (listing: PgSelect): Promise<Site[]> => {
    let page = listing.orderBy(desc(sites.createdAt));
    if (limit !== undefined) {
      page = page.limit(limit);
    }
    if (offset !== undefined) {
      page = page.offset(offset);
    }
    const rows = (await page) as SiteRow[];
    return rows.map(mapRowToSite);
  };

  // A caller already authorized for the whole organization sees all of its
  // sites. Narrowing by their own site roles would hand a superadmin an empty
  // list for an account they can administer but were never granted a site in.
  if (organizationId !== undefined && includeAllOrgSites === true) {
    return paged(
      db()
        .select()
        .from(sites)
        .where(and(eq(sites.organizationId, organizationId), archivedFilter))
        .$dynamic(),
    );
  }

  // A global agent reaches every site, so its own grants do not narrow the
  // listing. The acting user's access does, and is required: without it one key
  // would enumerate every site on the platform.
  const delegatedUserId =
    principalType === 'agent'
    && actingUserId !== undefined
    && (await isGlobalAgentId(principalId))
      ? actingUserId
      : undefined;

  const siteColumns = getTableColumns(sites);

  if (delegatedUserId !== undefined) {
    // Delegated authority: the result is the acting user's own sites, so it can
    // never exceed what that user could see directly.
    return paged(
      db()
        .selectDistinct(siteColumns)
        .from(sites)
        .innerJoin(userSiteRoles, eq(userSiteRoles.siteId, sites.id))
        .where(and(eq(userSiteRoles.userId, delegatedUserId), archivedFilter, orgFilter))
        .$dynamic(),
    );
  }

  if (principalType === 'agent') {
    // PCC-3190: when an agent acts on behalf of a user, intersect with
    // the user's site roles so the result never leaks beyond what the
    // acting user could see directly. The revoked_at filter on the agent
    // grant must remain in either branch.
    const grantedToAgent = and(
      eq(agentSiteRoles.agentId, principalId),
      isNull(agentSiteRoles.revokedAt),
    );

    if (actingUserId !== undefined) {
      return paged(
        db()
          .selectDistinct(siteColumns)
          .from(sites)
          .innerJoin(agentSiteRoles, eq(agentSiteRoles.siteId, sites.id))
          .innerJoin(userSiteRoles, eq(userSiteRoles.siteId, sites.id))
          .where(and(grantedToAgent, eq(userSiteRoles.userId, actingUserId), archivedFilter, orgFilter))
          .$dynamic(),
      );
    }

    return paged(
      db()
        .selectDistinct(siteColumns)
        .from(sites)
        .innerJoin(agentSiteRoles, eq(agentSiteRoles.siteId, sites.id))
        .where(and(grantedToAgent, archivedFilter, orgFilter))
        .$dynamic(),
    );
  }

  return paged(
    db()
      .selectDistinct(siteColumns)
      .from(sites)
      .innerJoin(userSiteRoles, eq(userSiteRoles.siteId, sites.id))
      .where(and(eq(userSiteRoles.userId, principalId), archivedFilter, orgFilter))
      .$dynamic(),
  );
}

/**
 * Retrieves allowed origins for a site (for OAuth redirect URI validation).
 * Returns null when the site does not exist, empty array when origins not configured.
 */
export async function getSiteAllowedOrigins(siteId: string): Promise<string[] | null> {
  const [originsRow] = await db()
    .select({ allowedOrigins: sites.allowedOrigins })
    .from(sites)
    .where(eq(sites.id, siteId));

  // Null means no such site. app.sites.allowed_origins is NOT NULL DEFAULT
  // '{}', so a site that configured none reads as an empty array.
  return originsRow?.allowedOrigins ?? null;
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
export async function getCachedSiteAllowedOrigins(siteId: string): Promise<string[] | null> {
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

/**
 * The site owner's display name and picture, or null when no owner grant exists.
 * Agent-created sites get an 'admin' grant instead, so null is ordinary.
 */
export async function getSiteOwner(
  siteId: string,
): Promise<{ name: string; avatarUrl: string | null } | null> {
  // app.users.id is uuid and user_site_roles.user_id is text, so the join casts
  // rather than comparing across types.
  const [row] = await db()
    .select({
      ownerName: sql<string | null>`COALESCE(${users.name}, ${users.email})`,
      avatarUrl: users.avatarUrl,
    })
    .from(userSiteRoles)
    .leftJoin(users, eq(sql`${users.id}::text`, userSiteRoles.userId))
    .where(and(eq(userSiteRoles.siteId, siteId), eq(userSiteRoles.role, 'owner')))
    .orderBy(desc(userSiteRoles.updatedAt))
    .limit(1);

  // The join is LEFT, so a grant naming a user with no row yields a null name.
  if (row?.ownerName == null) return null;
  return { name: row.ownerName, avatarUrl: row.avatarUrl };
}
