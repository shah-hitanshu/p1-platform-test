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

import { and, desc, eq, isNull, sql, type InferSelectModel } from 'drizzle-orm';
import { agentApiKeys } from '../db/schema';
import { db } from '../db/scope';

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
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface ValidateKeyResult {
  keyId: string;
  agentId: string;
}

/** The columns metadata is built from; hashes are never among them. */
type KeyMetadataColumns = Pick<
  InferSelectModel<typeof agentApiKeys>,
  'id' | 'agentId' | 'prefix' | 'name' | 'createdBy' | 'createdAt' | 'lastUsedAt' | 'revokedAt'
>;

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

function mapRowToMetadata(row: KeyMetadataColumns): KeyMetadata {
  return {
    id: row.id,
    agentId: row.agentId,
    prefix: row.prefix,
    name: row.name,
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

  const rows = await db()
    .insert(agentApiKeys)
    .values({
      agentId: params.agentId,
      tokenHash,
      prefix,
      name: params.name,
      createdBy: params.createdBy,
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error('Failed to insert agent API key');
  }

  return {
    key: rawKey,
    metadata: mapRowToMetadata(row),
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

  const rows = await db()
    .select({ id: agentApiKeys.id, agentId: agentApiKeys.agentId })
    .from(agentApiKeys)
    .where(and(eq(agentApiKeys.tokenHash, tokenHash), isNull(agentApiKeys.revokedAt)));

  const row = rows[0];
  if (!row) {
    return null;
  }

  // Fire-and-forget: update last_used_at without blocking the response. A
  // builder runs only when awaited, so `execute()` is what starts the statement.
  void db()
    .update(agentApiKeys)
    .set({ lastUsedAt: sql`NOW()` })
    .where(eq(agentApiKeys.tokenHash, tokenHash))
    .execute();

  return {
    keyId: row.id,
    agentId: row.agentId,
  };
}

/**
 * List active (non-revoked) keys for an agent (metadata only, never hashes).
 */
export async function listKeys(agentId: string): Promise<KeyMetadata[]> {
  const rows = await db()
    .select({
      id: agentApiKeys.id,
      agentId: agentApiKeys.agentId,
      prefix: agentApiKeys.prefix,
      name: agentApiKeys.name,
      createdBy: agentApiKeys.createdBy,
      createdAt: agentApiKeys.createdAt,
      lastUsedAt: agentApiKeys.lastUsedAt,
      revokedAt: agentApiKeys.revokedAt,
    })
    .from(agentApiKeys)
    .where(and(eq(agentApiKeys.agentId, agentId), isNull(agentApiKeys.revokedAt)))
    .orderBy(desc(agentApiKeys.createdAt));

  return rows.map(mapRowToMetadata);
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
  const revoked = await db()
    .update(agentApiKeys)
    .set({ revokedAt: sql`NOW()` })
    .where(
      and(
        eq(agentApiKeys.id, keyId),
        eq(agentApiKeys.agentId, agentId),
        isNull(agentApiKeys.revokedAt),
      ),
    )
    .returning({ id: agentApiKeys.id });

  return revoked.length > 0;
}
