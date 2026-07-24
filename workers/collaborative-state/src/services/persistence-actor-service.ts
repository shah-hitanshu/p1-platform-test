/**
 * PCC-3457: Actor resolution for persistence entry points.
 *
 * PR #201 admitted OAuth subjects (`auth0|pn-*`, `google-oauth2|*`) as
 * realtime actorIds, but the persistence layer writes actorId into the uuid
 * `created_by_id` column. Passing a subject straight through fails the uuid
 * cast and (on the queue path) poisons the whole sync batch (incident
 * PCC-3464).
 *
 * This module resolves an incoming actorId to an `app.users.id` uuid at the
 * persistence boundary:
 *
 * - uuid actorId               -> passthrough, ZERO database queries
 * - `provider|subject` (user)  -> app.users lookup by principal_id; on miss,
 *                                 JIT-provision/link by verified email
 * - `provider|subject` (agent) -> UNRESOLVED (agents are never
 *                                 JIT-provisioned as users)
 * - other non-uuid actorId     -> passthrough (legacy/test identifiers;
 *                                 pre-PR#201 behavior preserved)
 *
 * Linking by email never hijacks a users row already claimed by a different
 * principal — the upsert only adopts rows whose principal_id is NULL.
 */

import { query } from '../db';
import { providerSubToUuid } from '../auth/uuid-v5';
import { UUID_RE } from '../utils/branch-ref';

// =============================================================================
// Types
// =============================================================================

/** Actor identity fields carried by a persistence payload. */
export interface ResolvableActor {
  actorId: string;
  actorType: 'user' | 'agent';
  /** Verified email from the realtime connection, when available. */
  actorEmail?: string;
  /** Verified display name from the realtime connection, when available. */
  actorName?: string;
}

/** Outcome of resolving one actor. */
export type ActorResolution =
  | { resolved: true; actorId: string }
  | { resolved: false; reason: string };

/** Resolver with per-call memoization (one entry per distinct actorId). */
export type ActorResolver = (actor: ResolvableActor) => Promise<ActorResolution>;

// =============================================================================
// Helpers
// =============================================================================

/** Checks if an error is a PostgreSQL unique constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23505'
  );
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * Resolve a single actor to a uuid usable in `created_by_id`.
 *
 * uuid actorIds (and legacy non-subject identifiers without a `|`) pass
 * through without touching the database. Database errors during resolution
 * propagate to the caller — they indicate connectivity problems, not an
 * unresolvable actor, and must keep the existing retry semantics.
 */
export async function resolveActor(actor: ResolvableActor): Promise<ActorResolution> {
  const { actorId, actorType, actorEmail, actorName } = actor;

  // A missing or empty actorId means a caller wired the wrong param — every
  // persistence write supplies one. Return unresolved so the caller skips it
  // as an unresolvable actor, instead of crashing on actorId.indexOf('|')
  // below with a TypeError. Log it: an empty id is a server-side defect.
  if (typeof actorId !== 'string' || actorId === '') {
    console.warn('resolveActor received a missing or empty actorId', { actorType });
    return { resolved: false, reason: 'actor id is missing or empty' };
  }

  // Fast path: already a uuid — passthrough regardless of actorType,
  // with ZERO database queries.
  if (UUID_RE.test(actorId)) {
    return { resolved: true, actorId };
  }

  // OAuth subjects always carry a `provider|subject` shape. Non-uuid
  // identifiers without a `|` are legacy/test identifiers — preserve the
  // pre-PR#201 passthrough behavior for them.
  const separatorIndex = actorId.indexOf('|');
  if (separatorIndex === -1) {
    return { resolved: true, actorId };
  }

  if (actorType !== 'user') {
    return {
      resolved: false,
      reason: 'agent principals are never JIT-provisioned as users',
    };
  }

  // principal_id is stored as a UUIDv5 derived from the full OAuth subject
  // (see providerSubToUuid('auth0', sub) in auth0-identity-provider.ts and
  // the login-enrichment write in index.ts). Convert before lookup/write.
  const principalUuid = await providerSubToUuid('auth0', actorId);

  // Look up an already-provisioned user by principal.
  const existing = await query<{ id: string }>(
    'SELECT id FROM app.users WHERE principal_id = $1',
    [principalUuid],
  );
  const existingId = existing.rows[0]?.id;
  if (existingId !== undefined) {
    return { resolved: true, actorId: existingId };
  }

  // Normalize like every other email write path (users-api.ts, index.ts) —
  // a mixed-case IdP email must link the admin's lowercase pre-provisioned
  // row, not create an invisible duplicate.
  const normalizedEmail = actorEmail?.trim().toLowerCase();
  if (normalizedEmail === undefined || normalizedEmail === '') {
    return {
      resolved: false,
      reason: 'no users row for principal and no verified email to provision one',
    };
  }

  const authProvider = actorId.slice(0, separatorIndex);
  if (authProvider === '') {
    return {
      resolved: false,
      reason: 'cannot derive auth provider from principal',
    };
  }

  // Allowlist bootstrap guard: app.users doubles as the login allowlist —
  // it activates once the first row exists (migration 017, index.ts). JIT
  // provisioning must never create that first row, or an incidental OAuth
  // edit in a fresh environment would lock everyone else out at login.
  // Mirrors the deliberate bootstrap handling in users-api.ts.
  const anyUsers = await query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM app.users) AS exists',
    [],
  );
  if (anyUsers.rows[0]?.exists !== true) {
    return {
      resolved: false,
      reason: 'users table is empty — JIT provisioning would activate the login allowlist',
    };
  }

  try {
    // JIT-provision, or link a pre-provisioned row (principal_id NULL) by
    // verified email. The WHERE guard means a row claimed by a DIFFERENT
    // principal returns no row — never hijacked. The OR arm covers the
    // same-principal race: a concurrent batch that just linked this exact
    // principal must resolve, not skip.
    const upserted = await query<{ id: string }>(
      `INSERT INTO app.users (email, name, principal_id, auth_provider)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET principal_id = EXCLUDED.principal_id, auth_provider = EXCLUDED.auth_provider
       WHERE app.users.principal_id IS NULL
          OR app.users.principal_id = EXCLUDED.principal_id
       RETURNING id`,
      [normalizedEmail, actorName ?? null, principalUuid, authProvider],
    );
    const upsertedId = upserted.rows[0]?.id;
    if (upsertedId !== undefined) {
      return { resolved: true, actorId: upsertedId };
    }
    return {
      resolved: false,
      reason: 'email is already linked to a different principal',
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Race: a concurrent writer provisioned the same principal_id between
      // our lookup and insert. The row exists now — re-run the lookup.
      const retry = await query<{ id: string }>(
        'SELECT id FROM app.users WHERE principal_id = $1',
        [principalUuid],
      );
      const retryId = retry.rows[0]?.id;
      if (retryId !== undefined) {
        return { resolved: true, actorId: retryId };
      }
      return {
        resolved: false,
        reason: 'concurrent provisioning race could not be resolved',
      };
    }
    throw error;
  }
}

/**
 * Create a resolver that memoizes results per distinct actorId.
 * Use one resolver per batch (batches carry up to 100 messages, typically
 * from few actors) so each actor is resolved at most once per call.
 */
export function createActorResolver(): ActorResolver {
  const cache = new Map<string, ActorResolution>();
  return async (actor: ResolvableActor): Promise<ActorResolution> => {
    const cached = cache.get(actor.actorId);
    if (cached !== undefined) {
      return cached;
    }
    const resolution = await resolveActor(actor);
    cache.set(actor.actorId, resolution);
    return resolution;
  };
}
