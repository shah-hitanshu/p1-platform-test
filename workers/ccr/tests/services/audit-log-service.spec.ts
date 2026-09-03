/**
 * Audit Log Service Tests (PCC-3479)
 *
 * The interesting behaviour is what happens when the INSERT fails: the action
 * being logged has already committed, so a logging failure must not surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Audit Log Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const actor = {
    dbUserId: 'actor-uuid',
    email: 'staff@pantheon.io',
    systemRole: 'superadmin',
  };

  describe('recordAuditEntry', () => {
    it('should insert the action, actor and target', async () => {
      const { recordAuditEntry } = await import('../../src/services/audit-log-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await recordAuditEntry({
        action: 'org_user.remove',
        actor,
        organizationId: 'org-uuid',
        targetType: 'user',
        targetId: 'target-uuid',
        targetLabel: 'removed@example.com',
        details: { role: 'admin' },
      });

      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];

      expect(sql).toContain('INSERT INTO app.audit_log');
      expect(params).toEqual([
        'org_user.remove',
        'actor-uuid',
        'staff@pantheon.io',
        'superadmin',
        'org-uuid',
        'user',
        'target-uuid',
        'removed@example.com',
        // The object itself, not a JSON string: the driver serializes into the
        // jsonb column, and pre-stringifying makes details->>'field' null.
        { role: 'admin' },
      ]);
    });

    // Platform-wide actions belong to no single account, and an unknown actor
    // is still worth recording — neither should turn into a dropped entry.
    it('should record nulls for the optional fields and default details to {}', async () => {
      const { recordAuditEntry } = await import('../../src/services/audit-log-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await recordAuditEntry({
        action: 'user.remove',
        actor: {},
        targetType: 'user',
      });

      const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([
        'user.remove',
        null,
        null,
        null,
        null,
        'user',
        null,
        null,
        {},
      ]);
    });

    // The action it describes has already committed and there is nothing to
    // roll back, so a failed write must not become a failed request.
    it('should swallow a database failure', async () => {
      const { recordAuditEntry } = await import('../../src/services/audit-log-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockRejectedValueOnce(new Error('relation "app.audit_log" does not exist'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(
        recordAuditEntry({ action: 'user.update', actor, targetType: 'user' }),
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
