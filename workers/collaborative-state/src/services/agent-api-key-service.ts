/**
 * Agent API Key Service
 *
 * Manages API keys for agent authentication.
 * Keys are opaque strings prefixed with "aak_", stored as SHA-256 hashes.
 * The raw key is returned only once at creation time.
 *
 * Unlike site API tokens (sat_), agent keys have no scopes.
 * Authorization is determined by per-site roles in agent_site_roles.
 */

import { query } from '../db';

// =============================================================================
// Types
// =============================================================================

export interface GenerateKeyParams {
  agentId: string;
  name: string;
  createdBy: string;
}

export interface GenerateKeyResult {
  /** Raw key -- shown only once */
  key: string;
  /** Key metadata (safe to store/display) */
  metadata: KeyMetadata;
}

export interface KeyMetadata {
  id: string;
  agentId: string;
  prefix: string;
  name: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ValidateKeyResult {
  keyId: string;
  agentId: string;
}

interface KeyRow {
  id: string;
  agent_id: string;
  token_hash: string;
  prefix: string;
  name: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// =============================================================================
// Constants
// =============================================================================

const KEY_PREFIX = 'aak_';
const KEY_RANDOM_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 8; // chars after aak_ to store for display

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

function mapRowToMetadata(row: KeyRow): KeyMetadata {
  return {
    id: row.id,
    agentId: row.agent_id,
    prefix: row.prefix,
    name: row.name,
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
 * Generate a new agent API key.
 *
 * @returns The raw key (shown once) and its metadata
 */
export async function generateKey(
  params: GenerateKeyParams,
): Promise<GenerateKeyResult> {
  if (!params.agentId || params.agentId.trim() === '') {
    throw new Error('agentId is required');
  }
  if (!params.name || params.name.trim() === '') {
    throw new Error('name is required');
  }
  if (!params.createdBy || params.createdBy.trim() === '') {
    throw new Error('createdBy is required');
  }

  // Generate random bytes and encode as base62
  const randomBytes = new Uint8Array(KEY_RANDOM_BYTES);
  crypto.getRandomValues(randomBytes);
  const randomPart = base62Encode(randomBytes);

  const rawKey = KEY_PREFIX + randomPart;
  const prefix = rawKey.substring(0, KEY_PREFIX.length + DISPLAY_PREFIX_LENGTH);
  const tokenHash = await sha256Hex(rawKey);

  const result = await query<KeyRow>(
    `INSERT INTO app.agent_api_keys (agent_id, token_hash, prefix, name, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.agentId, tokenHash, prefix, params.name, params.createdBy],
  );

  return {
    key: rawKey,
    metadata: mapRowToMetadata(result.rows[0]),
  };
}

/**
 * Validate a raw agent API key.
 *
 * Updates last_used_at on successful validation (fire-and-forget).
 *
 * @returns Key info if valid and not revoked, null otherwise
 */
export async function validateKey(
  rawKey: string,
): Promise<ValidateKeyResult | null> {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX) || rawKey === KEY_PREFIX) {
    return null;
  }

  const tokenHash = await sha256Hex(rawKey);

  const result = await query<KeyRow>(
    `SELECT id, agent_id
     FROM app.agent_api_keys
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Fire-and-forget: update last_used_at without blocking the response
  void query(
    'UPDATE app.agent_api_keys SET last_used_at = NOW() WHERE token_hash = $1',
    [tokenHash],
  );

  return {
    keyId: row.id,
    agentId: row.agent_id,
  };
}

/**
 * List active (non-revoked) keys for an agent (metadata only, never hashes).
 */
export async function listKeys(agentId: string): Promise<KeyMetadata[]> {
  const result = await query<KeyRow>(
    `SELECT id, agent_id, prefix, name, created_by, created_at, last_used_at, revoked_at
     FROM app.agent_api_keys
     WHERE agent_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [agentId],
  );

  return result.rows.map(mapRowToMetadata);
}

/**
 * Revoke a key by setting its revoked_at timestamp.
 *
 * @returns true if revoked, false if not found
 */
export async function revokeKey(
  keyId: string,
  agentId: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE app.agent_api_keys
     SET revoked_at = NOW()
     WHERE id = $1 AND agent_id = $2 AND revoked_at IS NULL`,
    [keyId, agentId],
  );

  return (result.rowCount ?? 0) > 0;
}
