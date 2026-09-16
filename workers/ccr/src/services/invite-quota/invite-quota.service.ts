import { getLogger } from '@pantheon-systems/p1-telemetry';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { auditLog } from '../../db/schema';
import { db } from '../../db/scope';

const ORG_LIMIT_PER_HOUR = 50;
const RECIPIENT_LIMIT_PER_DAY = 5;

export type QuotaVerdict = 'ok' | 'exceeded' | 'unknown';

/**
 * Counts invites already in the audit log. Runs before the audit entry for the
 * current request, so an invite is never counted against itself. A failed
 * count is 'unknown', never a throw: the membership is already committed.
 *
 * Best-effort: concurrent requests read the count before any has written its
 * own audit row, so a burst can slip through. This gates email sends only —
 * the membership write has already committed by the time this runs.
 */
export async function checkInviteQuota(
  organizationId: string,
  recipientEmail: string,
): Promise<QuotaVerdict> {
  try {
    const recentInvites = and(
      eq(auditLog.action, 'org_user.add'),
      eq(auditLog.organizationId, organizationId),
    );
    const [[byOrg], [byRecipient]] = await Promise.all([
      db()
        .select({ count: count() })
        .from(auditLog)
        .where(and(recentInvites, gt(auditLog.createdAt, sql`NOW() - INTERVAL '1 hour'`))),
      db()
        .select({ count: count() })
        .from(auditLog)
        .where(and(
          recentInvites,
          eq(sql`lower(${auditLog.targetLabel})`, recipientEmail.toLowerCase()),
          gt(auditLog.createdAt, sql`NOW() - INTERVAL '1 day'`),
        )),
    ]);

    const orgCount = byOrg?.count ?? 0;
    const recipientCount = byRecipient?.count ?? 0;

    return orgCount >= ORG_LIMIT_PER_HOUR || recipientCount >= RECIPIENT_LIMIT_PER_DAY
      ? 'exceeded'
      : 'ok';
  } catch (error) {
    getLogger().error('Invite quota check failed', error instanceof Error ? error : new Error(String(error)), { organization_id: organizationId });
    return 'unknown';
  }
}
