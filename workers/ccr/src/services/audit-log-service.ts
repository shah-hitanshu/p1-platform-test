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
import { auditLog } from '../db/schema';
import { db } from '../db/scope';

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
    await db().insert(auditLog).values({
      action: entry.action,
      actorUserId: entry.actor.dbUserId ?? null,
      actorEmail: entry.actor.email ?? null,
      actorSystemRole: entry.actor.systemRole ?? null,
      organizationId: entry.organizationId ?? null,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel ?? null,
      details: entry.details ?? {},
    });
  } catch (error) {
    getLogger().error('Audit log write failed', error instanceof Error ? error : new Error(String(error)), { action: entry.action });
  }
}
