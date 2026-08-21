/**
 * `includeTombstoned` on listDocumentsOnBranch/countDocumentsOnBranch — lets
 * Site Structure request tombstoned rows explicitly, while every other
 * caller (public rendering, existing editor listing) keeps the default
 * exclusion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('listDocumentsOnBranch includeTombstoned', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('excludes tombstoned documents by default', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-1', {});

    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('top.is_tombstone = false');
  });

  it('omits the tombstone exclusion when includeTombstoned is true', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-1', { includeTombstoned: true });

    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).not.toContain('top.is_tombstone = false');
  });
});

describe('countDocumentsOnBranch includeTombstoned', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('excludes tombstoned documents by default', async () => {
    const { countDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await countDocumentsOnBranch('branch-1', {});

    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('is_tombstone = true');
  });

  it('omits the tombstone exclusion when includeTombstoned is true', async () => {
    const { countDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await countDocumentsOnBranch('branch-1', { includeTombstoned: true });

    const [sql] = vi.mocked(db.query).mock.calls[0];
    expect(sql).not.toContain('is_tombstone = true');
  });
});
