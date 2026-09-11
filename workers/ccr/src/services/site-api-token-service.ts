/**
 * Site API Token Service
 *
 * Manages per-site API tokens for application-level authentication.
 * Tokens are opaque strings prefixed with "sat_", stored as SHA-256 hashes.
 * The raw token is returned only once at creation time.
 */

import { and, desc, eq, isNull, sql, type InferSelectModel } from 'drizzle-orm';
import { siteApiTokens } from '../db/schema';
import { db } from '../db/scope';

// =============================================================================
// Types
// =============================================================================

export interface GenerateTokenParams {
  siteId: string;
  name: string;
  scopes?: string[];
  createdBy: string;
}

export interface GenerateTokenResult {
  /** Raw token — shown only once */
  token: string;
  /** Token metadata (safe to store/display) */
  metadata: TokenMetadata;
}

export interface TokenMetadata {
  id: string;
  siteId: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdBy: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface ValidateTokenResult {
  tokenId: string;
  siteId: string;
  scopes: string[];
}

/** The columns metadata is built from; hashes are never among them. */
type TokenMetadataColumns = Pick<
  InferSelectModel<typeof siteApiTokens>,
  | 'id'
  | 'siteId'
  | 'prefix'
  | 'name'
  | 'scopes'
  | 'createdBy'
  | 'createdAt'
  | 'lastUsedAt'
  | 'revokedAt'
>;

// =============================================================================
// Constants
// =============================================================================

const TOKEN_PREFIX = 'sat_';
const TOKEN_RANDOM_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 8; // chars after sat_ to store for display
const DEFAULT_SCOPES = ['read:published'];

const VALIDATION_CACHE_TTL_MS = 60_000;
const VALIDATION_CACHE_MAX_ENTRIES = 1_000;

export const VALID_SCOPES = ['read:published', 'read:all', 'read:draft', 'write:create', 'write:registry'] as const;
export type TokenScope = typeof VALID_SCOPES[number];

// Base62 alphabet for encoding
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// =============================================================================
// Helpers
// =============================================================================

function base62Encode(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += BASE62_CHARS.charAt(byte % 62);
  }
  return result;
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Per-isolate memoization of token validation.
 *
 * Keyed by token hash (never the raw token) and storing the in-flight promise,
 * so a burst of concurrent requests carrying the same token collapses into a
 * single Postgres lookup. Both hits and misses are cached: junk-token storms
 * are exactly the case this shields against.
 *
 * Revocation clears this isolate's cache immediately; other isolates hold the
 * stale positive entry for at most VALIDATION_CACHE_TTL_MS.
 */
interface ValidationCacheEntry {
  promise: Promise<ValidateTokenResult | null>;
  expiresAt: number;
}

const validationCache = new Map<string, ValidationCacheEntry>();

function memoizedLookup(tokenHash: string): Promise<ValidateTokenResult | null> {
  const cached = validationCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  validationCache.delete(tokenHash);

  if (validationCache.size >= VALIDATION_CACHE_MAX_ENTRIES) {
    const oldest = validationCache.keys().next().value;
    if (oldest !== undefined) {
      validationCache.delete(oldest);
    }
  }

  const promise = lookupTokenByHash(tokenHash);
  validationCache.set(tokenHash, {
    promise,
    expiresAt: Date.now() + VALIDATION_CACHE_TTL_MS,
  });
  // A failed query must not be served for the rest of the TTL.
  promise.catch(() => {
    if (validationCache.get(tokenHash)?.promise === promise) {
      validationCache.delete(tokenHash);
    }
  });
  return promise;
}

async function lookupTokenByHash(
  tokenHash: string,
): Promise<ValidateTokenResult | null> {
  const rows = await db()
    .select({
      id: siteApiTokens.id,
      siteId: siteApiTokens.siteId,
      scopes: siteApiTokens.scopes,
    })
    .from(siteApiTokens)
    .where(and(eq(siteApiTokens.tokenHash, tokenHash), isNull(siteApiTokens.revokedAt)));

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    tokenId: row.id,
    siteId: row.siteId,
    scopes: row.scopes,
  };
}

export function clearTokenValidationCache(): void {
  validationCache.clear();
}

function mapRowToMetadata(row: TokenMetadataColumns): TokenMetadata {
  return {
    id: row.id,
    siteId: row.siteId,
    prefix: row.prefix,
    name: row.name,
    scopes: row.scopes,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Generate a new site API token.
 *
 * @returns The raw token (shown once) and its metadata
 */
export async function generateToken(
  params: GenerateTokenParams,
): Promise<GenerateTokenResult> {
  if (!params.siteId || params.siteId.trim() === '') {
    throw new Error('siteId is required');
  }
  if (!params.name || params.name.trim() === '') {
    throw new Error('name is required');
  }
  if (!params.createdBy || params.createdBy.trim() === '') {
    throw new Error('createdBy is required');
  }

  const scopes = params.scopes ?? DEFAULT_SCOPES;

  const invalidScopes = scopes.filter((s) => !VALID_SCOPES.includes(s as TokenScope));
  if (invalidScopes.length > 0) {
    throw new Error(`Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')}`);
  }

  // Generate random bytes and encode as base62
  const randomBytes = new Uint8Array(TOKEN_RANDOM_BYTES);
  crypto.getRandomValues(randomBytes);
  const randomPart = base62Encode(randomBytes);

  const rawToken = TOKEN_PREFIX + randomPart;
  const prefix = rawToken.substring(0, TOKEN_PREFIX.length + DISPLAY_PREFIX_LENGTH);
  const tokenHash = await sha256Hex(rawToken);

  const rows = await db()
    .insert(siteApiTokens)
    .values({
      siteId: params.siteId,
      tokenHash,
      prefix,
      name: params.name,
      scopes,
      createdBy: params.createdBy,
    })
    .returning();

  const tokenRow = rows[0];
  if (!tokenRow) {
    throw new Error('Failed to generate token');
  }
  return {
    token: rawToken,
    metadata: mapRowToMetadata(tokenRow),
  };
}

/**
 * Validate a raw site API token.
 *
 * Results are memoized per isolate for a short TTL (see memoizedLookup), so
 * repeat requests carrying the same token skip the Postgres round trip.
 *
 * @returns Token info if valid and not revoked, null otherwise
 */
export async function validateToken(
  rawToken: string,
): Promise<ValidateTokenResult | null> {
  if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX) || rawToken === TOKEN_PREFIX) {
    return null;
  }

  const tokenHash = await sha256Hex(rawToken);
  return memoizedLookup(tokenHash);
}

/**
 * List active (non-revoked) tokens for a site (metadata only, never hashes).
 */
export async function listTokens(siteId: string): Promise<TokenMetadata[]> {
  const rows = await db()
    .select({
      id: siteApiTokens.id,
      siteId: siteApiTokens.siteId,
      prefix: siteApiTokens.prefix,
      name: siteApiTokens.name,
      scopes: siteApiTokens.scopes,
      createdBy: siteApiTokens.createdBy,
      createdAt: siteApiTokens.createdAt,
      lastUsedAt: siteApiTokens.lastUsedAt,
      revokedAt: siteApiTokens.revokedAt,
    })
    .from(siteApiTokens)
    .where(and(eq(siteApiTokens.siteId, siteId), isNull(siteApiTokens.revokedAt)))
    .orderBy(desc(siteApiTokens.createdAt));

  return rows.map(mapRowToMetadata);
}

/**
 * Revoke a token by setting its revoked_at timestamp.
 *
 * @returns true if revoked, false if not found
 */
export async function revokeToken(
  tokenId: string,
  siteId: string,
): Promise<boolean> {
  const updated = await db()
    .update(siteApiTokens)
    .set({ revokedAt: sql`NOW()` })
    .where(
      and(
        eq(siteApiTokens.id, tokenId),
        eq(siteApiTokens.siteId, siteId),
        isNull(siteApiTokens.revokedAt),
      ),
    )
    .returning({ id: siteApiTokens.id });

  const revoked = updated.length > 0;
  if (revoked) {
    // Entries are keyed by hash and we only have the id; revocation is rare
    // enough that dropping the whole isolate-local cache is the simple answer.
    clearTokenValidationCache();
  }
  return revoked;
}
