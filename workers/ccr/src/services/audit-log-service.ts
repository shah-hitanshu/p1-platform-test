/**
 * Audit Log Service
 *
 * Writes to app.audit_log — who did what to whom. Used by the user-management
 * routes today; `targetType` keeps it open to agents, sites and anything else
 * worth recording, so callers should not read "user" into any of this.
 *
 * Every actor is recorded, superadmin or not. The actor's platform role goes on
 * the row, so "what has Pantheon staff been doing" stays a query rather than a
 * branch in each write path.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { AuthenticatedPrincipal } from '../types';
import { query } from '../db';

export interface AuditEntry {
  /** '<entity>.<verb>', e.g. 'org_user.remove'. */
  action: string;
  actor: Pick<AuthenticatedPrincipal, 'dbUserId' | 'email' | 'systemRole'>;
  /** The kind of thing acted on: 'user' today, more later. */
  targetType: string;
  targetId?: string;
  /** Human-readable stand-in for targetId — an email, a name. */
  targetLabel?: string;
  /** The business account the action happened in, if it happened in one. */
  organizationId?: string;
  /** What changed: the fields the request set, and their new values. */
  details?: Record<string, unknown>;
}

/**
 * Records one entry. Never throws.
 *
 * By the time this is called the action it describes has already committed,
 * and there is no transaction to roll back — so letting a logging failure
 * reach the caller would turn a missing audit row into a user-facing error
 * without undoing anything. A failure is logged and swallowed instead.
 */
export async function recordAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO app.audit_log
         (action, actor_user_id, actor_email, actor_system_role,
          organization_id, target_type, target_id, target_label, details)
       VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6, $7, $8, $9::jsonb)`,
      [
        entry.action,
        entry.actor.dbUserId ?? null,
        entry.actor.email ?? null,
        entry.actor.systemRole ?? null,
        entry.organizationId ?? null,
        entry.targetType,
        entry.targetId ?? null,
        entry.targetLabel ?? null,
        // The driver serializes an object into the jsonb column. Stringifying
        // first stores a JSON *string*, which makes details->>'field' null and
        // the column unqueryable.
        entry.details ?? {},
      ],
    );
  } catch (error) {
    getLogger().error('Audit log write failed', error instanceof Error ? error : new Error(String(error)), { action: entry.action });
  }
}
