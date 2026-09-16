import { describe, it, expect, beforeEach } from 'vitest';

import { auditLog } from '../../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../../__stubs__/database';
import { checkInviteQuota } from '../../../src/services/invite-quota/invite-quota.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const HOURLY = /1 hour/;
const DAILY = /1 day/;

describe('checkInviteQuota', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  function counts(byOrg: number, byRecipient: number): void {
    database.on(auditLog).select.whenAsking(HOURLY).returnsRaw([{ count: String(byOrg) }]);
    database.on(auditLog).select.whenAsking(DAILY).returnsRaw([{ count: String(byRecipient) }]);
  }

  it('allows the first invite', async () => {
    counts(0, 0);
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('ok');
  });

  it('blocks at the organization limit, not one past it', async () => {
    counts(50, 0);
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('exceeded');
  });

  it('allows one below the organization limit', async () => {
    counts(49, 0);
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('ok');
  });

  it('blocks at the recipient limit', async () => {
    counts(0, 5);
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('exceeded');
  });

  it('lowercases the recipient before counting', async () => {
    counts(0, 0);
    await checkInviteQuota(ORG, 'MiXeD@X.com');
    const daily = database.calls(auditLog).select.find((call) => call.sql.includes('1 day'));
    expect(daily?.params).toContain('mixed@x.com');
  });

  it('reports unknown rather than throwing when a count fails', async () => {
    database.on(auditLog).select.rejects(new Error('connection lost'));
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('unknown');
  });

  it('counts only org_user.add, scoped to the organization and the last hour', async () => {
    counts(0, 0);
    await checkInviteQuota(ORG, 'a@x.com');
    const [hourly, daily] = database.calls(auditLog).select;

    expect(hourly.sql).toContain("INTERVAL '1 hour'");
    expect(hourly.sql).toMatch(/"action" = \$\d/);
    expect(hourly.sql).toMatch(/"organization_id" = \$\d/);
    expect(hourly.params).toEqual(['org_user.add', ORG]);

    expect(daily.sql).toContain("INTERVAL '1 day'");
    expect(daily.sql).toMatch(/lower\("app"\."audit_log"\."target_label"\) = \$\d/);
    expect(daily.params).toEqual(['org_user.add', ORG, 'a@x.com']);
  });
});
