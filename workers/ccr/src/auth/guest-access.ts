/**
 * Phase 2.2: Authorization System - Guest Access Validation
 *
 * Handles guest link creation, validation, and access tracking.
 * Guests access specific branches via magic links with fixed VIEWER permissions.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Guest Access"
 */

import * as crypto from 'crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { GuestLink, GuestLinkStatus, RolePermissions, RoleName, PantheonRole } from '../types';
import { guestLinks } from '../db/schema';
import { db } from '../db/scope';
import { ROLES } from './roles';

/**
 * Guest principal returned after successful token validation.
 */
export interface GuestPrincipal {
  id: string;
  type: 'guest';
  email: string;
  name: string | null;
  branchId: string;
  pantheonSiteRoles: Record<string, PantheonRole>;
  tokenExpiry: Date;
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
export async function validateGuestToken(
  token: string,
): Promise<GuestPrincipal | null> {
  const tokenHash = hashToken(token);

  // Query for active, non-expired guest link
  const rows = await db()
    .select()
    .from(guestLinks)
    .where(
      and(
        eq(guestLinks.tokenHash, tokenHash),
        eq(guestLinks.status, 'active'),
        gt(guestLinks.expiresAt, sql`NOW()`),
      ),
    );

  const guestLink = rows[0];
  if (!guestLink) {
    return null;
  }

  // Update access tracking (fire and forget)
  await db()
    .update(guestLinks)
    .set({
      accessCount: sql`${guestLinks.accessCount} + 1`,
      lastAccessAt: sql`NOW()`,
    })
    .where(eq(guestLinks.id, guestLink.id));

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
  const expiresAt = new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000);

  const rows = await db()
    .insert(guestLinks)
    .values({
      branchId: options.branchId,
      email: options.email,
      name: options.name,
      tokenHash,
      status: 'active',
      expiresAt,
      createdById: options.createdById,
      createdByType: options.createdByType,
      message: options.message,
      accessCount: 0,
    })
    .returning({ id: guestLinks.id });

  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create guest link: no row returned');
  }

  return {
    id: row.id,
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
  const rows = await db()
    .update(guestLinks)
    .set({ status: 'revoked' })
    .where(eq(guestLinks.id, linkId))
    .returning({ id: guestLinks.id });

  return rows.length > 0;
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
  const scope =
    options.includeRevoked === true
      ? eq(guestLinks.branchId, branchId)
      : and(eq(guestLinks.branchId, branchId), eq(guestLinks.status, 'active'));

  const rows = await db().select().from(guestLinks).where(scope);

  return rows.map(toGuestLink);
}

/** The status and creator-type columns are text, narrowed to their domain unions here. */
function toGuestLink(row: typeof guestLinks.$inferSelect): GuestLink {
  return {
    ...row,
    status: row.status as GuestLinkStatus,
    createdByType: row.createdByType as 'user' | 'agent',
  };
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
