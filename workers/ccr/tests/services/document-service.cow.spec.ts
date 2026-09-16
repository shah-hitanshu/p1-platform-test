/**
 * Copy-on-Write (COW) Document Service Tests
 *
 * Tests for the `inherited` boolean field returned by listDocumentsOnBranch
 * when operating in COW branching mode.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 * They should FAIL initially because the `inherited` field is not yet
 * included in the return type or query results.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { listDocumentsOnBranch } from '../../src/services/document-service';

describe('Copy-on-Write: listDocumentsOnBranch inherited field', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  it('should return inherited: false for documents with local versions', async () => {
    // The COW UNION result: a local document, marked not inherited.
    stub.on('u').select.returnsRaw([
      {
        id: 'doc-1',
        site_id: 'site-1',
        path: 'pages/about',
        created_at: '2026-01-01T00:00:00.000Z',
        archived_at: null,
        inherited: false,
      },
    ]);

    const result = await listDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
    });

    expect(result).toHaveLength(1);
    expect(result[0].inherited).toBe(false);
    expect(result[0].path).toBe('pages/about');
  });

  it('should return inherited: true for documents inherited from main', async () => {
    stub.on('u').select.returnsRaw([
      {
        id: 'doc-1',
        site_id: 'site-1',
        path: 'pages/about',
        created_at: '2026-01-01T00:00:00.000Z',
        archived_at: null,
        inherited: false,
      },
      {
        id: 'doc-2',
        site_id: 'site-1',
        path: 'pages/home',
        created_at: '2026-01-01T00:00:00.000Z',
        archived_at: null,
        inherited: true,
      },
    ]);

    const result = await listDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
    });

    expect(result).toHaveLength(2);
    expect(result[0].inherited).toBe(false);
    expect(result[1].inherited).toBe(true);
  });

  it('should return inherited: false for all docs when no mainBranchId provided', async () => {
    stub.on('u').select.returnsRaw([
      {
        id: 'doc-1',
        site_id: 'site-1',
        path: 'pages/about',
        created_at: '2026-01-01T00:00:00.000Z',
        archived_at: null,
        inherited: false,
      },
    ]);

    const result = await listDocumentsOnBranch('branch-main');

    expect(result).toHaveLength(1);
    expect(result[0].inherited).toBe(false);
  });

  it('should exclude tombstoned documents from main in the inherited arm', async () => {
    await listDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
    });

    const { sql } = stub.statements[0];
    // The inherited arm should check for tombstones on main
    // (latest version on main has _deleted = true)
    const unionIndex = sql.indexOf('UNION');
    const inheritedArm = sql.slice(unionIndex);
    expect(inheritedArm).toContain('is_tombstone');
    expect(inheritedArm).toContain('ORDER BY dv.version_number DESC');
  });

  it('should include inherited column in COW UNION query', async () => {
    await listDocumentsOnBranch('branch-feature', {
      mainBranchId: 'branch-main',
    });

    const { sql } = stub.statements[0];
    // The SQL should include 'false' and 'true' as inherited markers
    expect(sql).toContain('false');
    expect(sql).toContain('true');
    // Should have UNION
    expect(sql).toContain('UNION');
  });
});
