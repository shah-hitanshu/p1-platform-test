/**
 * Site API Token Service
 *
 * Manages per-site API tokens for application-level authentication.
 * Tokens are opaque strings prefixed with "sat_", stored as SHA-256 hashes.
 * The raw token is returned only once at creation time.
 */

import { query } from '../db';

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
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ValidateTokenResult {
  tokenId: string;
  siteId: string;
  scopes: string[];
}

interface TokenRow {
  id: string;
  site_id: string;
  token_hash: string;
  prefix: string;
  name: string;
  scopes: string[];
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// =============================================================================
// Constants
// =============================================================================

const TOKEN_PREFIX = 'sat_';
const TOKEN_RANDOM_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 8; // chars after sat_ to store for display
const DEFAULT_SCOPES = ['read:published'];

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

function mapRowToMetadata(row: TokenRow): TokenMetadata {
  return {
    id: row.id,
    siteId: row.site_id,
    prefix: row.prefix,
    name: row.name,
    scopes: row.scopes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
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

  // Generate random bytes and encode as base62
  const randomBytes = new Uint8Array(TOKEN_RANDOM_BYTES);
  crypto.getRandomValues(randomBytes);
  const randomPart = base62Encode(randomBytes);

  const rawToken = TOKEN_PREFIX + randomPart;
  const prefix = rawToken.substring(0, TOKEN_PREFIX.length + DISPLAY_PREFIX_LENGTH);
  const tokenHash = await sha256Hex(rawToken);

  const result = await query<TokenRow>(
    `INSERT INTO app.site_api_tokens (site_id, token_hash, prefix, name, scopes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [params.siteId, tokenHash, prefix, params.name, scopes, params.createdBy],
  );

  return {
    token: rawToken,
    metadata: mapRowToMetadata(result.rows[0]),
  };
}

/**
 * Validate a raw site API token.
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

  const result = await query<TokenRow>(
    `SELECT id, site_id, scopes
     FROM app.site_api_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    tokenId: row.id,
    siteId: row.site_id,
    scopes: row.scopes,
  };
}

/**
 * List active (non-revoked) tokens for a site (metadata only, never hashes).
 */
export async function listTokens(siteId: string): Promise<TokenMetadata[]> {
  const result = await query<TokenRow>(
    `SELECT id, site_id, prefix, name, scopes, created_by, created_at, last_used_at, revoked_at
     FROM app.site_api_tokens
     WHERE site_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [siteId],
  );

  return result.rows.map(mapRowToMetadata);
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
  const result = await query(
    `UPDATE app.site_api_tokens
     SET revoked_at = NOW()
     WHERE id = $1 AND site_id = $2 AND revoked_at IS NULL`,
    [tokenId, siteId],
  );

  return (result.rowCount ?? 0) > 0;
}
