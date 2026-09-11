/**
 * Phase 7.1d: Grant Service
 *
 * Service for managing branch-level access grants.
 * Grants can elevate an actor's permissions on specific branches.
 */

import { and, desc, eq } from 'drizzle-orm';
import { branchGrants } from '../db/schema';
import { db } from '../db/scope';
import { DuplicateGrantError } from './errors';
import type { RoleName } from '../types';

/**
 * Grant type representing a branch permission grant
 */
export interface Grant {
  id: string;
  branchId: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: RoleName;
  grantedById: string;
  grantedByType: 'user' | 'agent';
  reason: string | null;
  grantedAt: Date | null;
}

/**
 * Parameters for creating a grant
 */
export interface CreateGrantParams {
  branchId: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: RoleName;
  grantedById: string;
  grantedByType: 'user' | 'agent';
  reason?: string;
}

/**
 * Options for listing grants
 */
export interface ListGrantsOptions {
  branchId: string;
  actorType?: 'user' | 'agent';
  role?: RoleName;
}

function rowToGrant(row: typeof branchGrants.$inferSelect): Grant {
  return {
    id: row.id,
    branchId: row.branchId,
    actorId: row.actorId,
    actorType: row.actorType as 'user' | 'agent',
    role: row.role as RoleName,
    grantedById: row.grantedById,
    grantedByType: row.grantedByType as 'user' | 'agent',
    reason: row.reason,
    grantedAt: row.grantedAt,
  };
}

/**
 * Create a new grant for an actor on a branch
 */
export async function createGrant(params: CreateGrantParams): Promise<Grant> {
  const {
    branchId,
    actorId,
    actorType,
    role,
    grantedById,
    grantedByType,
    reason,
  } = params;

  // Check if grant already exists
  const existing = await db()
    .select({ id: branchGrants.id })
    .from(branchGrants)
    .where(and(eq(branchGrants.branchId, branchId), eq(branchGrants.actorId, actorId)));

  if (existing.length > 0) {
    throw new DuplicateGrantError(branchId, actorId);
  }

  const [row] = await db()
    .insert(branchGrants)
    .values({
      branchId,
      actorId,
      actorType,
      role,
      grantedById,
      grantedByType,
      reason,
    })
    .returning();

  if (row === undefined) {
    throw new Error('Failed to insert grant');
  }

  return rowToGrant(row);
}

/**
 * Get a grant by ID
 */
export async function getGrant(grantId: string): Promise<Grant | null> {
  const [row] = await db().select().from(branchGrants).where(eq(branchGrants.id, grantId));

  return row === undefined ? null : rowToGrant(row);
}

/**
 * List grants for a branch
 */
export async function listGrants(options: ListGrantsOptions): Promise<Grant[]> {
  const { branchId, actorType, role } = options;

  const conditions = [eq(branchGrants.branchId, branchId)];

  if (actorType !== undefined) {
    conditions.push(eq(branchGrants.actorType, actorType));
  }

  if (role !== undefined) {
    conditions.push(eq(branchGrants.role, role));
  }

  const rows = await db()
    .select()
    .from(branchGrants)
    .where(and(...conditions))
    .orderBy(desc(branchGrants.grantedAt));

  return rows.map(rowToGrant);
}

/**
 * Delete a grant by ID
 * @returns true if the grant was deleted, false if it didn't exist
 */
export async function deleteGrant(grantId: string): Promise<boolean> {
  const deleted = await db()
    .delete(branchGrants)
    .where(eq(branchGrants.id, grantId))
    .returning({ id: branchGrants.id });

  return deleted.length > 0;
}
