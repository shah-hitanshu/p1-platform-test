/**
 * Phase 3.2: Branch Service
 *
 * CRUD operations for Branches with status management and main branch protection.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Branches"
 */

import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type InferSelectModel } from 'drizzle-orm';
import type { Branch, BranchStatus } from '../types';
import { driverErrorCode } from '../db/driver-error';
import { toIsoTimestamp } from '../db/helpers';
import { db, transaction } from '../db/scope';
import {
  branchDocumentMetadata,
  branchStructureState,
  branches,
  checkpointDocumentMetadata,
  checkpointDocuments,
  checkpointStructures,
  checkpoints,
  documentVersions,
  mergeRequests,
  sites,
} from '../db/schema';
import {
  SiteNotFoundError,
  DuplicateBranchNameError,
  InvalidBranchParamsError,
  MainBranchProtectionError,
  InvalidBranchStatusTransitionError,
  MainBranchOnlyError,
  DatabaseError,
} from './errors';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new branch.
 */
export interface CreateBranchParams {
  siteId: string;
  name: string;
  description?: string;
  sourceBranchId: string;
  sourceCheckpointId?: string;
  createdById: string;
  createdByType: 'user' | 'agent';
}

/**
 * Parameters for creating the main branch.
 */
export interface CreateMainBranchParams {
  siteId: string;
  createdById: string;
  createdByType: 'user' | 'agent';
}

/**
 * Parameters for updating a branch.
 */
export interface UpdateBranchParams {
  name?: string;
  description?: string;
}

/**
 * Options for listing branches.
 */
export interface ListBranchesOptions {
  status?: BranchStatus;
  limit?: number;
  offset?: number;
  /** Filter by soft-delete state. true = archived only, false/undefined = active only. */
  archived?: boolean;
}

/** A branch row as the schema declares it. */
type BranchRow = InferSelectModel<typeof branches>;

// =============================================================================
// Status Transition Rules
// =============================================================================

/**
 * Valid status transitions for branches.
 * - active → review (submit for review)
 * - active → archived (archive without merging)
 * - review → active (back to development)
 * - review → merged (complete merge)
 * - Same status → same status (no-op)
 */
const VALID_TRANSITIONS: Record<BranchStatus, BranchStatus[]> = {
  active: ['active', 'review', 'archived'],
  review: ['review', 'active', 'merged'],
  merged: ['merged'], // Terminal state - no transitions out
  archived: ['archived'], // Terminal state - no transitions out
};

/**
 * Checks if a status transition is valid.
 *
 * @param from - Current status
 * @param to - Target status
 * @returns True if the transition is valid
 */
export function isValidStatusTransition(from: BranchStatus, to: BranchStatus): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets.includes(to);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Maps a database row to a Branch domain object.
 */
function mapRowToBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as BranchStatus,
    isMain: row.isMain,
    sourceBranchId: row.sourceBranchId ?? undefined,
    sourceCheckpointId: row.sourceCheckpointId ?? undefined,
    createdById: row.createdById,
    createdByType: row.createdByType as Branch['createdByType'],
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    archivedAt: row.archivedAt === null ? null : toIsoTimestamp(row.archivedAt),
  };
}

/**
 * Gets the first row from a query result, throwing if not present.
 * Use this when an INSERT/UPDATE with RETURNING should always return a row.
 */
function getFirstRow<T>(rows: T[]): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('Expected query to return at least one row');
  }
  return first;
}

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return driverErrorCode(error) === '23505';
}

/**
 * Checks if an error is a PostgreSQL foreign key constraint violation.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return driverErrorCode(error) === '23503';
}

// =============================================================================
// Per-isolate branch resolution cache [PCC-3712]
// =============================================================================

/**
 * Per-isolate memoization of branch resolution, mirroring the site-API-token
 * validation cache shipped in PCC-3634 (site-api-token-service.ts).
 *
 * Branch metadata is resolved on nearly every content request — main-branch
 * lookup on the default path, id/name lookup when ?branch= is given — but
 * changes rarely; in the 2026-08-19 CloudSQL saturation incident these point
 * lookups were 54% of summed DB query time. Entries are keyed by three shapes
 * (branch id, siteId+name, main-of-site) and store the in-flight promise, so
 * concurrent requests coalesce into a single query. Both hits and misses are
 * cached: junk ?branch= values are part of what this shields against.
 *
 * Staleness trade: branch mutations in this isolate clear the cache
 * immediately (see clearBranchCache callers, including site-service's bulk
 * branch archive/restore/delete); other isolates serve stale metadata for at
 * most BRANCH_CACHE_TTL_MS — the same bounded-staleness trade accepted for
 * token revocation in PCC-3634. Mutation paths validate against uncached
 * reads, so protection and transition checks never act on stale rows.
 */
const BRANCH_CACHE_TTL_MS = 30_000;
const BRANCH_CACHE_MAX_ENTRIES = 1_000;

interface BranchCacheEntry {
  promise: Promise<Branch | null>;
  expiresAt: number;
}

const branchCache = new Map<string, BranchCacheEntry>();

function memoizedBranchLookup(
  cacheKey: string,
  lookup: () => Promise<Branch | null>,
): Promise<Branch | null> {
  const cached = branchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  branchCache.delete(cacheKey);

  if (branchCache.size >= BRANCH_CACHE_MAX_ENTRIES) {
    const oldest = branchCache.keys().next().value;
    if (oldest !== undefined) {
      branchCache.delete(oldest);
    }
  }

  const promise = lookup();
  branchCache.set(cacheKey, {
    promise,
    expiresAt: Date.now() + BRANCH_CACHE_TTL_MS,
  });
  // A failed query must not be served for the rest of the TTL.
  promise.catch(() => {
    if (branchCache.get(cacheKey)?.promise === promise) {
      branchCache.delete(cacheKey);
    }
  });
  return promise;
}

/**
 * Drops every entry in this isolate's branch cache. Mutations are rare enough
 * relative to reads that dropping the whole isolate-local cache is the simple
 * answer — the same call revokeToken makes in site-api-token-service.
 */
export function clearBranchCache(): void {
  branchCache.clear();
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Creates a new branch from a source branch.
 * Copies structure state and document metadata from the source branch or checkpoint.
 *
 * @param params - Branch creation parameters
 * @returns The created branch
 * @throws InvalidBranchParamsError if required fields are missing or invalid
 * @throws SiteNotFoundError if the site does not exist
 * @throws DuplicateBranchNameError if branch name already exists in site
 */
export async function createBranch(params: CreateBranchParams): Promise<Branch> {
  // Validate required fields
  if (!params.name || params.name.trim() === '') {
    throw new InvalidBranchParamsError('Branch name is required');
  }
  if (!params.sourceBranchId || params.sourceBranchId.trim() === '') {
    throw new InvalidBranchParamsError('Source branch ID is required');
  }
  if (!params.siteId || params.siteId.trim() === '') {
    throw new InvalidBranchParamsError('Site ID is required');
  }
  if (!params.createdById || params.createdById.trim() === '') {
    throw new InvalidBranchParamsError('Created by ID is required');
  }

  try {
    const created = await transaction(async () => {
      // Validate source branch is the main branch (copy-on-write: branches only from main)
      const [sourceBranch] = await db()
        .select({ id: branches.id, isMain: branches.isMain })
        .from(branches)
        .where(eq(branches.id, params.sourceBranchId));

      if (sourceBranch?.isMain !== true) {
        throw new MainBranchOnlyError(params.sourceBranchId);
      }

      const inserted = await db()
        .insert(branches)
        .values({
          siteId: params.siteId,
          name: params.name.trim(),
          description: params.description ?? null,
          status: 'active',
          isMain: false,
          sourceBranchId: params.sourceBranchId,
          sourceCheckpointId: params.sourceCheckpointId ?? null,
          createdById: params.createdById,
          createdByType: params.createdByType,
        })
        .returning();

      const branch = mapRowToBranch(getFirstRow(inserted));

      // Copy-on-write: only copy structure state (navigation tree must be independent per branch)
      // Document versions and metadata are NOT copied — they inherit from main via fallback
      if (params.sourceCheckpointId !== undefined) {
        // Copy structure from checkpoint
        await db().execute(sql`
          INSERT INTO app.branch_structure_state (
            branch_id, structure_id, name, slug, description, structure_type,
            structure_tree, metadata_schema, schema_enforcement
          )
          SELECT ${branch.id}::uuid, cs.structure_id, cs.name, cs.slug, cs.description, cs.structure_type,
                 cs.structure_tree, cs.metadata_schema, cs.schema_enforcement
          FROM app.checkpoint_structures cs
          WHERE cs.checkpoint_id = ${params.sourceCheckpointId}::uuid
        `);
      } else {
        // Copy structure from current branch state
        await db().execute(sql`
          INSERT INTO app.branch_structure_state (
            branch_id, structure_id, name, slug, description, structure_type,
            structure_tree, metadata_schema, schema_enforcement
          )
          SELECT ${branch.id}::uuid, bss.structure_id, bss.name, bss.slug, bss.description, bss.structure_type,
                 bss.structure_tree, bss.metadata_schema, bss.schema_enforcement
          FROM app.branch_structure_state bss
          WHERE bss.branch_id = ${params.sourceBranchId}::uuid
        `);

        // Auto-resolve source_checkpoint_id from latest checkpoint on source branch
        const [latestCheckpoint] = await db()
          .select({ id: checkpoints.id })
          .from(checkpoints)
          .where(eq(checkpoints.branchId, params.sourceBranchId))
          .orderBy(desc(checkpoints.createdAt))
          .limit(1);

        if (latestCheckpoint) {
          const [updatedRow] = await db()
            .update(branches)
            .set({ sourceCheckpointId: latestCheckpoint.id })
            .where(eq(branches.id, branch.id))
            .returning();
          if (updatedRow) {
            return mapRowToBranch(updatedRow);
          }
        }
      }

      return branch;
    });

    clearBranchCache();
    return created;
  } catch (error) {
    if (error instanceof MainBranchOnlyError) {
      throw error;
    }
    console.error('createBranch error:', error);
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateBranchNameError(params.siteId, params.name);
    }
    if (isForeignKeyViolation(error)) {
      throw new SiteNotFoundError(params.siteId);
    }
    throw new DatabaseError(`Failed to create branch: ${error instanceof Error ? error.message : String(error)}`, 'createBranch');
  }
}

/**
 * Creates the main branch for a site.
 * Each site should have exactly one main branch.
 *
 * @param params - Main branch creation parameters
 * @returns The created main branch
 * @throws SiteNotFoundError if the site does not exist
 * @throws DuplicateBranchNameError if main branch already exists
 */
export async function createMainBranch(params: CreateMainBranchParams): Promise<Branch> {
  try {
    const inserted = await db()
      .insert(branches)
      .values({
        siteId: params.siteId,
        name: 'main',
        description: 'Main branch',
        status: 'active',
        isMain: true,
        sourceBranchId: null,
        sourceCheckpointId: null,
        createdById: params.createdById,
        createdByType: params.createdByType,
      })
      .returning();

    clearBranchCache();
    return mapRowToBranch(getFirstRow(inserted));
  } catch (error) {
    console.error('createMainBranch error:', error);
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateBranchNameError(params.siteId, 'main');
    }
    if (isForeignKeyViolation(error)) {
      throw new SiteNotFoundError(params.siteId);
    }
    throw new DatabaseError(`Failed to create main branch: ${error instanceof Error ? error.message : String(error)}`, 'createMainBranch');
  }
}

/** Uncached lookup by id — used by mutation paths, which must not act on stale rows. */
async function queryBranchById(branchId: string): Promise<Branch | null> {
  const [row] = await db().select().from(branches).where(eq(branches.id, branchId));

  return row === undefined ? null : mapRowToBranch(row);
}

/**
 * Retrieves a branch by its ID.
 *
 * Results are memoized per isolate for a short TTL (see branchCache above).
 *
 * @param branchId - The branch ID
 * @returns The branch or null if not found
 */
export function getBranch(branchId: string): Promise<Branch | null> {
  return memoizedBranchLookup(`id:${branchId}`, () => queryBranchById(branchId));
}

/**
 * Retrieves a branch by name within a site.
 *
 * Results are memoized per isolate for a short TTL (see branchCache above).
 *
 * @param siteId - The site ID
 * @param name - The branch name
 * @returns The branch or null if not found
 */
export function getBranchByName(siteId: string, name: string): Promise<Branch | null> {
  return memoizedBranchLookup(`name:${siteId}:${name}`, async () => {
    const [row] = await db()
      .select()
      .from(branches)
      .where(and(eq(branches.siteId, siteId), eq(branches.name, name)));

    return row === undefined ? null : mapRowToBranch(row);
  });
}

/**
 * Retrieves the main branch for a site.
 *
 * Results are memoized per isolate for a short TTL (see branchCache above).
 *
 * @param siteId - The site ID
 * @returns The main branch or null if not found
 */
export function getMainBranch(siteId: string): Promise<Branch | null> {
  return memoizedBranchLookup(`main:${siteId}`, async () => {
    const [row] = await db()
      .select()
      .from(branches)
      .where(and(eq(branches.siteId, siteId), eq(branches.isMain, true)));

    return row === undefined ? null : mapRowToBranch(row);
  });
}

/**
 * Soft-deletes a branch by setting archived_at.
 * Returns false if not found, 'already_archived' if already soft-deleted,
 * and throws MainBranchProtectionError for the main branch.
 */
export async function archiveBranch(branchId: string): Promise<boolean | 'already_archived'> {
  const branch = await queryBranchById(branchId);
  if (branch === null) {
    return false;
  }
  if (branch.isMain) {
    throw new MainBranchProtectionError('archive');
  }
  const archived = await transaction(() =>
    db()
      .update(branches)
      .set({ archivedAt: sql`NOW()` })
      .where(and(eq(branches.id, branchId), isNull(branches.archivedAt)))
      .returning({ id: branches.id }),
  );

  clearBranchCache();
  return archived.length > 0 ? true : 'already_archived';
}

/**
 * Restores a soft-deleted branch. Returns null if not found, not archived,
 * or if the parent site is archived.
 */
export async function restoreBranch(branchId: string): Promise<Branch | null> {
  const [row] = await db().select().from(branches).where(eq(branches.id, branchId));
  if (row?.archivedAt == null) {
    return null;
  }
  // Refuse to restore a branch whose site is archived
  const [site] = await db()
    .select({ archivedAt: sites.archivedAt })
    .from(sites)
    .where(eq(sites.id, row.siteId));
  if (site?.archivedAt != null) {
    return null;
  }

  const restored = await transaction(() =>
    db()
      .update(branches)
      .set({ archivedAt: null })
      .where(eq(branches.id, branchId))
      .returning(),
  );

  clearBranchCache();
  const updatedRow = restored[0];
  if (!updatedRow) {
    return null;
  }
  return mapRowToBranch(updatedRow);
}

/**
 * Lists branches for a site with optional filtering.
 *
 * @param siteId - The site ID
 * @param options - Filtering and pagination options
 * @returns Array of branches
 */
export async function listBranches(
  siteId: string,
  options: ListBranchesOptions = {},
): Promise<Branch[]> {
  const { status, limit, offset, archived } = options;

  let listing = db()
    .select()
    .from(branches)
    .where(
      and(
        eq(branches.siteId, siteId),
        archived === true ? isNotNull(branches.archivedAt) : isNull(branches.archivedAt),
        status === undefined ? undefined : eq(branches.status, status),
      ),
    )
    .orderBy(desc(branches.createdAt))
    .$dynamic();

  if (limit !== undefined) {
    listing = listing.limit(limit);
  }
  if (offset !== undefined) {
    listing = listing.offset(offset);
  }

  const rows = await listing;

  return rows.map(mapRowToBranch);
}

/**
 * Updates a branch's name and/or description.
 *
 * @param branchId - The branch ID
 * @param updates - Fields to update
 * @returns The updated branch or null if not found
 * @throws InvalidBranchParamsError if name is empty
 * @throws DuplicateBranchNameError if new name already exists in site
 */
export async function updateBranch(
  branchId: string,
  updates: UpdateBranchParams,
): Promise<Branch | null> {
  // Validate name if provided
  if (updates.name?.trim() === '') {
    throw new InvalidBranchParamsError('Branch name cannot be empty');
  }

  // Convert empty description to null (clearing description)
  const description = updates.description === '' ? null : updates.description;

  try {
    const updated = await db()
      .update(branches)
      .set({
        name: sql`COALESCE(${updates.name ?? null}::text, ${branches.name})`,
        description: sql`COALESCE(${description ?? null}::text, ${branches.description})`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(branches.id, branchId))
      .returning();

    if (updated.length === 0) {
      return null;
    }

    clearBranchCache();
    return mapRowToBranch(getFirstRow(updated));
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateBranchNameError('unknown', updates.name ?? '');
    }
    throw new DatabaseError('Failed to update branch', 'updateBranch');
  }
}

/**
 * Updates a branch's status with transition validation.
 *
 * @param branchId - The branch ID
 * @param newStatus - The new status
 * @returns The updated branch or null if not found
 * @throws MainBranchProtectionError if trying to archive the main branch
 * @throws InvalidBranchStatusTransitionError if the transition is not valid
 */
export async function updateBranchStatus(
  branchId: string,
  newStatus: BranchStatus,
): Promise<Branch | null> {
  // Get current branch state (uncached: transition validation must not act on
  // a stale row)
  const current = await queryBranchById(branchId);
  if (!current) {
    return null;
  }

  // Check main branch protection for archiving
  if (current.isMain && newStatus === 'archived') {
    throw new MainBranchProtectionError('archive');
  }

  // Validate status transition
  if (!isValidStatusTransition(current.status, newStatus)) {
    throw new InvalidBranchStatusTransitionError(current.status, newStatus);
  }

  // If no actual change, return current state
  if (current.status === newStatus) {
    return current;
  }

  const updated = await db()
    .update(branches)
    .set({ status: newStatus, updatedAt: sql`NOW()` })
    .where(eq(branches.id, branchId))
    .returning();

  if (updated.length === 0) {
    return null;
  }

  clearBranchCache();
  return mapRowToBranch(getFirstRow(updated));
}

/**
 * Deletes a branch.
 *
 * @param branchId - The branch ID
 * @returns True if deleted, false if not found
 * @throws MainBranchProtectionError if trying to delete the main branch
 */
export async function deleteBranch(branchId: string): Promise<boolean> {
  // Check if branch exists and is not main (uncached: protection check must
  // not act on a stale row)
  const branch = await queryBranchById(branchId);
  if (!branch) {
    return false;
  }

  if (branch.isMain) {
    throw new MainBranchProtectionError('delete');
  }

  // Delete related data in order to avoid foreign key constraint violations
  // Note: branch_grants and guest_links have ON DELETE CASCADE, so they are handled automatically

  const checkpointsOnBranch = db()
    .select({ id: checkpoints.id })
    .from(checkpoints)
    .where(eq(checkpoints.branchId, branchId));

  // 1. Delete merge requests where this branch is source or target
  await db()
    .delete(mergeRequests)
    .where(
      or(
        eq(mergeRequests.sourceBranchId, branchId),
        eq(mergeRequests.targetBranchId, branchId),
      ),
    );

  // 2. Delete branch document metadata
  await db().delete(branchDocumentMetadata).where(eq(branchDocumentMetadata.branchId, branchId));

  // 3. Delete branch structure state
  await db().delete(branchStructureState).where(eq(branchStructureState.branchId, branchId));

  // 4. Delete checkpoint documents for checkpoints on this branch
  await db()
    .delete(checkpointDocuments)
    .where(inArray(checkpointDocuments.checkpointId, checkpointsOnBranch));

  // 5. Delete checkpoint structures for checkpoints on this branch
  await db()
    .delete(checkpointStructures)
    .where(inArray(checkpointStructures.checkpointId, checkpointsOnBranch));

  // 6. Delete checkpoint document metadata for checkpoints on this branch
  await db()
    .delete(checkpointDocumentMetadata)
    .where(inArray(checkpointDocumentMetadata.checkpointId, checkpointsOnBranch));

  // 7. Delete checkpoints
  await db().delete(checkpoints).where(eq(checkpoints.branchId, branchId));

  // 8. Delete document versions
  await db().delete(documentVersions).where(eq(documentVersions.branchId, branchId));

  // 9. Finally, delete the branch
  const deleted = await db()
    .delete(branches)
    .where(eq(branches.id, branchId))
    .returning({ id: branches.id });

  clearBranchCache();
  return deleted.length > 0;
}
