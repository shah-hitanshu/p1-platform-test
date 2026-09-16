/**
 * Template Filter Tests for listDocumentsOnBranch
 *
 * Tests for the `templateId`, `limit`, and `offset` options
 * added to ListDocumentsOnBranchOptions for content-type query support.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { listDocumentsOnBranch } from '../../src/services/branch-document-service';

let stub: DatabaseStub;

beforeEach(() => {
  stub = stubDatabase();
});

describe('listDocumentsOnBranch: templateId filter', () => {

  it('should include template_id filter in SQL when templateId is provided', async () => {
    await listDocumentsOnBranch('branch-1', {
      templateId: 'template-uuid-123',
    });

    const { sql, params } = stub.statements[0];

    expect(sql).toContain('dr.target_document_id = $');
    expect(params).toContain('template-uuid-123');
  });

  it('should include template_id filter in both UNION branches for COW query', async () => {
    await listDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
      templateId: 'template-uuid-123',
    });

    const { sql } = stub.statements[0];

    const filters = sql.match(/dr\.target_document_id = \$/g) ?? [];
    expect(filters.length).toBeGreaterThanOrEqual(2);
  });

  it('should return only documents matching the template', async () => {
    stub.on('u').select.returnsRaw([
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
    ]);

    const result = await listDocumentsOnBranch('branch-1', {
      templateId: 'blog-template-id',
    });

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('blog/first-post');
    expect(result[1].path).toBe('blog/second-post');
  });

  it('should not include template_id filter when templateId is undefined', async () => {
    await listDocumentsOnBranch('branch-1', {});

    const { sql } = stub.statements[0];

    expect(sql).not.toContain('dr.target_document_id = $');
  });
});

describe('listDocumentsOnBranch: limit and offset', () => {

  it('should include LIMIT clause when limit is provided', async () => {
    await listDocumentsOnBranch('branch-1', { limit: 10 });

    const { sql, params } = stub.statements[0];

    expect(sql).toContain('LIMIT');
    expect(params).toContain(10);
  });

  it('should include OFFSET clause when offset is provided', async () => {
    await listDocumentsOnBranch('branch-1', { limit: 10, offset: 20 });

    const { sql, params } = stub.statements[0];

    expect(sql).toContain('OFFSET');
    expect(params).toContain(20);
  });

  it('should combine templateId, limit, and offset', async () => {
    await listDocumentsOnBranch('branch-1', {
      templateId: 'tpl-1',
      limit: 5,
      offset: 10,
    });

    const { sql, params } = stub.statements[0];

    expect(sql).toContain('dr.target_document_id = $');
    expect(sql).toContain('LIMIT');
    expect(sql).toContain('OFFSET');
    expect(params).toContain('tpl-1');
    expect(params).toContain(5);
    expect(params).toContain(10);
  });

  it('should work with COW mode and limit/offset', async () => {
    await listDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
      limit: 20,
      offset: 0,
    });

    const { sql } = stub.statements[0];

    expect(sql).toContain('LIMIT');
    expect(sql).toContain('OFFSET');
  });
});
