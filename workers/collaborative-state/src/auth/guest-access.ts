/**
 * Phase 2.2: Authorization System - Guest Access Validation
 *
 * Handles guest link creation, validation, and access tracking.
 * Guests access specific branches via magic links with fixed VIEWER permissions.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Guest Access"
 */

import * as crypto from 'crypto';
import type { GuestLink, RolePermissions, RoleName, PantheonRole } from '../types';
import { query } from '../db';
import { ROLES } from './roles';

/**
 * Guest principal returned after successful token validation.
 */
export interface GuestPrincipal {
  id: string;
  type: 'guest';
  email: string;
  name?: string;
  branchId: string;
  pantheonSiteRoles: Record<string, PantheonRole>;
  tokenExpiry: string;
  roleName: RoleName;
}

/**
 * Options for creating a guest link.
 */
export interface CreateGuestLinkOptions {
  branchId: string;
  email: string;
  name?: string;
  createdById: string;
  createdByType: 'user' | 'agent';
  expiresInHours: number;
  message?: string;
}

/**
 * Result of creating a guest link.
 * The token is returned only once and should be sent to the guest.
 */
export interface CreateGuestLinkResult {
  id: string;
  token: string; // Unhashed token - return once to sender
}

/**
 * Options for listing guest links.
 */
export interface GetGuestLinksOptions {
  includeRevoked?: boolean;
}

/**
 * Fixed VIEWER role for guest users.
 * Guests can only view, never edit.
 */
export const GUEST_ROLE: RolePermissions = ROLES.VIEWER;

/**
 * Hashes a token using SHA-256.
 *
 * @param token - The plaintext token
 * @returns The hexadecimal hash
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generates a secure random token.
 *
 * @returns A 32-byte hexadecimal token (64 characters)
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validates a guest access token and returns the guest principal.
 *
 * The token is hashed before database lookup for security.
 * Only active, non-expired links are valid.
 *
 * @param token - The plaintext guest access token
 * @returns The guest principal, or null if invalid/expired
 *
 * @example
 * ```typescript
 * const guest = await validateGuestToken(token);
 * if (guest) {
 *   // Guest is authenticated, proceed with VIEWER access
 * }
 * ```
 */
export async function validateGuestToken(token: string): Promise<GuestPrincipal | null> {
  const tokenHash = hashToken(token);

  // Query for active, non-expired guest link
  const result = await query<GuestLink>(
    `SELECT * FROM guest_links
     WHERE token_hash = $1
       AND status = 'active'
       AND expires_at > NOW()`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const guestLink = result.rows[0];

  // Update access tracking (fire and forget)
  await query(
    `UPDATE guest_links
     SET access_count = access_count + 1,
         last_access_at = NOW()
     WHERE id = $1`,
    [guestLink.id],
  );

  // Return guest principal
  return {
    id: guestLink.id,
    type: 'guest',
    email: guestLink.email,
    name: guestLink.name,
    branchId: guestLink.branchId,
    pantheonSiteRoles: {}, // Guests have no Pantheon roles
    tokenExpiry: guestLink.expiresAt,
    roleName: 'VIEWER',
  };
}

/**
 * Creates a new guest link for branch access.
 *
 * Generates a secure random token, stores the hash in the database,
 * and returns the plaintext token once to be sent to the guest.
 *
 * @param options - Guest link creation options
 * @returns The guest link ID and plaintext token
 *
 * @example
 * ```typescript
 * const { id, token } = await createGuestLink({
 *   branchId: 'branch-123',
 *   email: 'guest@example.com',
 *   name: 'Guest User',
 *   createdById: 'user-456',
 *   createdByType: 'user',
 *   expiresInHours: 24,
 *   message: 'Please review this branch',
 * });
 *
 * // Send token to guest via email
 * sendEmail(email, `Access link: ${baseUrl}?token=${token}`);
 * ```
 */
export async function createGuestLink(
  options: CreateGuestLinkOptions,
): Promise<CreateGuestLinkResult> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + options.expiresInHours * 60 * 60 * 1000,
  ).toISOString();

  const result = await query<{ id: string }>(
    `INSERT INTO guest_links (
       branch_id, email, name, token_hash, status,
       expires_at, created_by_id, created_by_type, message, access_count
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      options.branchId,
      options.email,
      options.name,
      tokenHash,
      'active',
      expiresAt,
      options.createdById,
      options.createdByType,
      options.message,
      0,
    ],
  );

  return {
    id: result.rows[0].id,
    token,
  };
}

/**
 * Revokes a guest link, preventing further access.
 *
 * @param linkId - The guest link ID to revoke
 * @returns True if the link was revoked, false if not found
 *
 * @example
 * ```typescript
 * const success = await revokeGuestLink('link-123');
 * if (success) {
 *   console.log('Guest link revoked');
 * }
 * ```
 */
export async function revokeGuestLink(linkId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `UPDATE guest_links
     SET status = 'revoked'
     WHERE id = $1
     RETURNING id`,
    [linkId],
  );

  return result.rows.length > 0;
}

/**
 * Gets all guest links for a branch.
 *
 * By default, only returns active links. Use includeRevoked to get all.
 *
 * @param branchId - The branch ID
 * @param options - Query options
 * @returns Array of guest links
 *
 * @example
 * ```typescript
 * const activeLinks = await getGuestLinksByBranch('branch-123');
 * const allLinks = await getGuestLinksByBranch('branch-123', { includeRevoked: true });
 * ```
 */
export async function getGuestLinksByBranch(
  branchId: string,
  options: GetGuestLinksOptions = {},
): Promise<GuestLink[]> {
  if (options.includeRevoked === true) {
    const result = await query<GuestLink>(
      'SELECT * FROM guest_links WHERE branch_id = $1',
      [branchId],
    );
    return result.rows;
  }

  const result = await query<GuestLink>(
    `SELECT * FROM guest_links
     WHERE branch_id = $1 AND status = 'active'`,
    [branchId],
  );

  return result.rows;
}

/**
 * Checks if a guest principal has access to a specific branch.
 *
 * Guests are scoped to a single branch and cannot access other branches.
 *
 * @param guest - The guest principal
 * @param branchId - The branch ID to check access for
 * @returns True if the guest has access to this branch
 *
 * @example
 * ```typescript
 * if (isGuestBranchAccess(guestPrincipal, requestedBranchId)) {
 *   // Allow access
 * } else {
 *   // Deny - guest trying to access wrong branch
 * }
 * ```
 */
export function isGuestBranchAccess(guest: GuestPrincipal, branchId: string): boolean {
  return guest.branchId === branchId;
}
