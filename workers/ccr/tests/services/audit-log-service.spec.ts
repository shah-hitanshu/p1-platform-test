/**
 * Audit Log Service Tests (PCC-3479)
 *
 * The interesting behaviour is what happens when the INSERT fails: the action
 * being logged has already committed, so a logging failure must not surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditLog } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

describe('Audit Log Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  const actor = {
    dbUserId: 'actor-uuid',
    email: 'staff@pantheon.io',
    systemRole: 'superadmin',
  };

  describe('recordAuditEntry', () => {
    it('should insert the action, actor and target', async () => {
      const { recordAuditEntry } = await import('../../src/services/audit-log-service');

      database.on(auditLog).insert.returns([]);

      await recordAuditEntry({
        action: 'org_user.remove',
        actor,
        organizationId: 'org-uuid',
        targetType: 'user',
        targetId: 'target-uuid',
        targetLabel: 'removed@example.com',
        details: { role: 'admin' },
      });

      expect(database.calls(auditLog).insert).toHaveLength(1);
      expect(database.calls(auditLog).insert[0].params).toEqual([
        'org_user.remove',
        'actor-uuid',
        'staff@pantheon.io',
        'superadmin',
        'org-uuid',
        'user',
        'target-uuid',
        'removed@example.com',
        // Drizzle stringifies the jsonb column itself and hands the driver a
        // plain string, so the recorded parameter is JSON text, not an object.
        JSON.stringify({ role: 'admin' }),
      ]);
    });

    // Platform-wide actions belong to no single account, and an unknown actor
    // is still worth recording — neither should turn into a dropped entry.
    it('should record nulls for the optional fields and default details to {}', async () => {
      const { recordAuditEntry } = await import('../../src/services/audit-log-service');

      database.on(auditLog).insert.returns([]);

      await recordAuditEntry({
        action: 'user.remove',
        actor: {},
        targetType: 'user',
      });

      expect(database.calls(auditLog).insert[0].params).toEqual([
        'user.remove',
        null,
        null,
        null,
        null,
        'user',
        null,
        null,
        JSON.stringify({}),
      ]);
    });

    // The action it describes has already committed and there is nothing to
    // roll back, so a failed write must not become a failed request.
    it('should swallow a database failure', async () => {
      const { recordAuditEntry } = await import('../../src/services/audit-log-service');

      database.on(auditLog).insert.rejects(new Error('relation "app.audit_log" does not exist'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(
        recordAuditEntry({ action: 'user.update', actor, targetType: 'user' }),
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
