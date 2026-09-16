import { getLogger } from '@pantheon-systems/p1-telemetry';
import { query } from '../../db';

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
    const [byOrg, byRecipient] = await Promise.all([
      query<{ count: string }>(
        `SELECT count(*) FROM app.audit_log
          WHERE action = 'org_user.add' AND organization_id = $1
            AND created_at > NOW() - INTERVAL '1 hour'`,
        [organizationId],
      ),
      query<{ count: string }>(
        `SELECT count(*) FROM app.audit_log
          WHERE action = 'org_user.add' AND organization_id = $1 AND lower(target_label) = $2
            AND created_at > NOW() - INTERVAL '1 day'`,
        [organizationId, recipientEmail.toLowerCase()],
      ),
    ]);

    const orgCount = Number(byOrg.rows[0]?.count ?? 0);
    const recipientCount = Number(byRecipient.rows[0]?.count ?? 0);

    return orgCount >= ORG_LIMIT_PER_HOUR || recipientCount >= RECIPIENT_LIMIT_PER_DAY
      ? 'exceeded'
      : 'ok';
  } catch (error) {
    getLogger().error('Invite quota check failed', error instanceof Error ? error : new Error(String(error)), { organization_id: organizationId });
    return 'unknown';
  }
}
