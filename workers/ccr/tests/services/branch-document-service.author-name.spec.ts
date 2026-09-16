import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { listDocumentsOnBranch } from '../../src/services/branch-document-service';
import { mapRowToDocumentOnBranch } from '../../src/services/document-types';

describe('listDocumentsOnBranch author resolution', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  it('selects a resolved last_modified_by_name in the outer query', async () => {
    await listDocumentsOnBranch('branch-1');

    const { sql } = stub.statements[0];
    expect(sql).toContain('last_modified_by_name');
    // Aliases must not be `u` — the wrapper already owns that alias and the
    // ORDER BY reads u.created_at / u.branch_path.
    expect(sql).toContain('LEFT JOIN app.users  au');
    expect(sql).toContain('LEFT JOIN app.agents ag ON ag.id = u.last_modified_by_id::text');
  });

  it('resolves each created_by_type, with email as the user fallback', async () => {
    await listDocumentsOnBranch('branch-1');

    const { sql } = stub.statements[0];
    // A real person with no display name must not read as "System".
    expect(sql).toContain("WHEN 'user'  THEN COALESCE(au.name, au.email)");
    expect(sql).toContain("WHEN 'agent' THEN ag.name");
    expect(sql).toContain("ELSE 'System'");
    // The outer COALESCE is what catches an id with no matching row.
    expect(sql).toContain("END, 'System') AS last_modified_by_name");
    // Only users carry a picture; app.agents has no avatar column.
    expect(sql).toContain("WHEN 'user' THEN au.avatar_url");
    expect(sql).toContain('AS last_modified_by_avatar_url');
  });

  it('keeps the outer ordering and pagination intact', async () => {
    await listDocumentsOnBranch('branch-1', { limit: 10, offset: 5 });

    const { sql } = stub.statements[0];
    expect(sql.lastIndexOf('ORDER BY')).toBeLessThan(sql.lastIndexOf('LIMIT $'));
    expect(sql).toMatch(/ORDER BY COALESCE\(u\.branch_path, u\.path\) ASC\s+LIMIT \$/);
  });

  it('maps the resolved name onto the document', async () => {
    const doc = mapRowToDocumentOnBranch({
      id: 'doc-1',
      site_id: 'site-1',
      path: 'about',
      created_at: '2026-01-01T00:00:00Z',
      inherited: false,
      branch_path: null,
      published_version_id: null,
      published_at: null,
      is_tombstone: false,
      snapshot_title: 'About',
      latest_version_at: '2026-02-01T00:00:00Z',
      last_modified_by_id: 'user-1',
      last_modified_by_type: 'user',
      last_modified_by_name: 'Alice Smith',
      last_modified_by_avatar_url: 'https://example.com/a.png',
    } as never);

    expect(doc.lastModifiedByName).toBe('Alice Smith');
    expect(doc.lastModifiedByAvatarUrl).toBe('https://example.com/a.png');
    expect(doc.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });
});
