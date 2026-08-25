/**
 * Template Filter Tests for listDocumentsOnBranch
 *
 * Tests for the `templateId`, `limit`, and `offset` options
 * added to ListDocumentsOnBranchOptions for content-type query support.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('listDocumentsOnBranch: templateId filter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should include template_id filter in SQL when templateId is provided', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-1', {
      templateId: 'template-uuid-123',
    });

    const sql = vi.mocked(db.query).mock.calls[0][0];
    const params = vi.mocked(db.query).mock.calls[0][1];

    expect(sql).toContain('template_id');
    expect(params).toContain('template-uuid-123');
  });

  it('should include template_id filter in both UNION branches for COW query', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
      templateId: 'template-uuid-123',
    });

    const sql = vi.mocked(db.query).mock.calls[0][0];

    const templateIdMatches = (sql.match(/template_id/g) ?? []).length;
    expect(templateIdMatches).toBeGreaterThanOrEqual(2);
  });

  it('should return only documents matching the template', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        {
          id: 'doc-blog-1',
          site_id: 'site-1',
          path: 'blog/first-post',
          created_at: '2026-01-01T00:00:00.000Z',
          archived_at: null,
          inherited: false,
          published_version_id: null,
          published_at: null,
        },
        {
          id: 'doc-blog-2',
          site_id: 'site-1',
          path: 'blog/second-post',
          created_at: '2026-01-02T00:00:00.000Z',
          archived_at: null,
          inherited: false,
          published_version_id: null,
          published_at: null,
        },
      ],
    });

    const result = await listDocumentsOnBranch('branch-1', {
      templateId: 'blog-template-id',
    });

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('blog/first-post');
    expect(result[1].path).toBe('blog/second-post');
  });

  it('should not include template_id filter when templateId is undefined', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-1', {});

    const sql = vi.mocked(db.query).mock.calls[0][0];

    expect(sql).not.toContain('AND d.template_id =');
  });
});

describe('listDocumentsOnBranch: limit and offset', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should include LIMIT clause when limit is provided', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-1', { limit: 10 });

    const sql = vi.mocked(db.query).mock.calls[0][0];
    const params = vi.mocked(db.query).mock.calls[0][1];

    expect(sql).toContain('LIMIT');
    expect(params).toContain(10);
  });

  it('should include OFFSET clause when offset is provided', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-1', { limit: 10, offset: 20 });

    const sql = vi.mocked(db.query).mock.calls[0][0];
    const params = vi.mocked(db.query).mock.calls[0][1];

    expect(sql).toContain('OFFSET');
    expect(params).toContain(20);
  });

  it('should combine templateId, limit, and offset', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-1', {
      templateId: 'tpl-1',
      limit: 5,
      offset: 10,
    });

    const sql = vi.mocked(db.query).mock.calls[0][0];
    const params = vi.mocked(db.query).mock.calls[0][1];

    expect(sql).toContain('template_id');
    expect(sql).toContain('LIMIT');
    expect(sql).toContain('OFFSET');
    expect(params).toContain('tpl-1');
    expect(params).toContain(5);
    expect(params).toContain(10);
  });

  it('should work with COW mode and limit/offset', async () => {
    const { listDocumentsOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await listDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
      limit: 20,
      offset: 0,
    });

    const sql = vi.mocked(db.query).mock.calls[0][0];

    expect(sql).toContain('LIMIT');
    expect(sql).toContain('OFFSET');
  });
});
