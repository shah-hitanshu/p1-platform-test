import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db', () => ({ query: vi.fn() }));

import { query } from '../../../src/db';
import { checkInviteQuota } from '../../../src/services/invite-quota/invite-quota.service';

const queryMock = vi.mocked(query);
const ORG = '11111111-1111-4111-8111-111111111111';

describe('checkInviteQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the first invite', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('ok');
  });

  it('blocks at the organization limit, not one past it', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '50' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('exceeded');
  });

  it('allows one below the organization limit', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '49' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('ok');
  });

  it('blocks at the recipient limit', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] });
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('exceeded');
  });

  it('lowercases the recipient before counting', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] });
    await checkInviteQuota(ORG, 'MiXeD@X.com');
    expect(queryMock.mock.calls[1][1]).toEqual([ORG, 'mixed@x.com']);
  });

  it('reports unknown rather than throwing when a count fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection lost'));
    await expect(checkInviteQuota(ORG, 'a@x.com')).resolves.toBe('unknown');
  });

  it('counts only org_user.add, scoped to the organization and the last hour', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] });
    await checkInviteQuota(ORG, 'a@x.com');
    const [orgSql, orgParams] = queryMock.mock.calls[0];
    expect(orgSql).toContain("action = 'org_user.add'");
    expect(orgSql).toContain('organization_id = $1');
    expect(orgSql).toContain("INTERVAL '1 hour'");
    expect(orgParams).toEqual([ORG]);

    const [rcptSql, rcptParams] = queryMock.mock.calls[1];
    expect(rcptSql).toContain('organization_id = $1');
    expect(rcptSql).toContain('lower(target_label) = $2');
    expect(rcptSql).toContain("INTERVAL '1 day'");
    expect(rcptParams).toEqual([ORG, 'a@x.com']);
  });
});
