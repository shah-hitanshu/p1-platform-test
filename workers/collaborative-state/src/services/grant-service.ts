/**
 * Phase 7.1d: Grant Service
 *
 * Service for managing branch-level access grants.
 * Grants can elevate an actor's permissions on specific branches.
 */

import { query } from '../db';
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
  reason?: string;
  grantedAt: string;
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

/**
 * Error thrown when a grant is not found
 */
export class GrantNotFoundError extends Error {
  public readonly name = 'GrantNotFoundError';

  constructor(public readonly grantId: string) {
    super(`Grant not found: ${grantId}`);
  }
}

/**
 * Error thrown when a duplicate grant is attempted
 */
export class DuplicateGrantError extends Error {
  public readonly name = 'DuplicateGrantError';

  constructor(
    public readonly branchId: string,
    public readonly actorId: string,
  ) {
    super(`Grant already exists for actor ${actorId} on branch ${branchId}`);
  }
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
  const existing = await query<{ id: string }>(
    `SELECT id FROM app.branch_grants
     WHERE branch_id = $1 AND actor_id = $2`,
    [branchId, actorId],
  );

  if (existing.rows.length > 0) {
    throw new DuplicateGrantError(branchId, actorId);
  }

  const result = await query<Grant>(
    `INSERT INTO app.branch_grants (
       branch_id, actor_id, actor_type, role,
       granted_by_id, granted_by_type, reason
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id,
       branch_id AS "branchId",
       actor_id AS "actorId",
       actor_type AS "actorType",
       role,
       granted_by_id AS "grantedById",
       granted_by_type AS "grantedByType",
       reason,
       granted_at AS "grantedAt"`,
    [branchId, actorId, actorType, role, grantedById, grantedByType, reason],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to insert grant');
  }

  return row;
}

/**
 * Get a grant by ID
 */
export async function getGrant(grantId: string): Promise<Grant | null> {
  const result = await query<Grant>(
    `SELECT
       id,
       branch_id AS "branchId",
       actor_id AS "actorId",
       actor_type AS "actorType",
       role,
       granted_by_id AS "grantedById",
       granted_by_type AS "grantedByType",
       reason,
       granted_at AS "grantedAt"
     FROM app.branch_grants
     WHERE id = $1`,
    [grantId],
  );

  return result.rows[0] ?? null;
}

/**
 * List grants for a branch
 */
export async function listGrants(options: ListGrantsOptions): Promise<Grant[]> {
  const { branchId, actorType, role } = options;

  let sql = `
    SELECT
      id,
      branch_id AS "branchId",
      actor_id AS "actorId",
      actor_type AS "actorType",
      role,
      granted_by_id AS "grantedById",
      granted_by_type AS "grantedByType",
      reason,
      granted_at AS "grantedAt"
    FROM app.branch_grants
    WHERE branch_id = $1
  `;

  const params: unknown[] = [branchId];
  let paramIndex = 2;

  if (actorType !== undefined) {
    sql += ` AND actor_type = $${String(paramIndex)}`;
    params.push(actorType);
    paramIndex++;
  }

  if (role !== undefined) {
    sql += ` AND role = $${String(paramIndex)}`;
    params.push(role);
    paramIndex++;
  }

  sql += ' ORDER BY granted_at DESC';

  const result = await query<Grant>(sql, params);
  return result.rows;
}

/**
 * Delete a grant by ID
 * @returns true if the grant was deleted, false if it didn't exist
 */
export async function deleteGrant(grantId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM app.branch_grants WHERE id = $1',
    [grantId],
  );

  return (result.rowCount ?? 0) > 0;
}
