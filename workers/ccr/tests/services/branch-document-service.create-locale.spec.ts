/**
 * A document's locale is settable at creation, stored in the canonical form
 * validateLocale returns so one locale has one spelling in storage.
 *
 * Reusing an existing (site_id, path) is routine here — branch copy-on-write,
 * recreation after a tombstone, repeated registry syncs — and that path reads
 * the stored row rather than writing to it, so a create that names a locale
 * cannot relabel a document that already exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

function docRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-uuid-456',
    site_id: 'site-uuid-123',
    path: 'pages/nouveau',
    created_at: '2026-07-07T10:00:00.000Z',
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'version-uuid-123',
    document_id: 'doc-uuid-456',
    branch_id: 'branch-uuid-789',
    version_number: 1,
    snapshot: {},
    source: 'edit',
    created_by_id: 'user-uuid-001',
    created_by_type: 'user',
    created_at: '2026-07-07T10:00:00.000Z',
    ...overrides,
  };
}

function documentInsertCall(calls: unknown[][]): { sql: string; params: unknown[] } {
  const call = calls.find(
    (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO app.documents'),
  );
  if (call === undefined) {
    throw new Error('No INSERT INTO app.documents call was captured');
  }
  return { sql: call[0] as string, params: (call[1] ?? []) as unknown[] };
}

describe('createDocumentOnBranch locale', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('stores the locale in canonical form', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [docRow({ locale: 'he' })] }) // INSERT document
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [versionRow()] }) // INSERT version
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    // `iw` is the deprecated tag for Hebrew; storage keeps the tag CLDR names.
    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/nouveau',
      locale: 'iw',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const { sql, params } = documentInsertCall(queryMock.mock.calls);
    expect(sql).toContain('locale');
    expect(params).toContain('he');
  });

  it('inserts no locale when none is given', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [docRow()] }) // INSERT document
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [versionRow()] }) // INSERT version
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/nouveau',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    void result;
    const { params } = documentInsertCall(queryMock.mock.calls);
    expect(params).toEqual(['site-uuid-123', 'pages/nouveau', null]);
  });

  it('rejects a malformed language tag before writing anything', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const { InvalidLocaleError } = await import('../../src/services/errors');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    await expect(
      createDocumentOnBranch({
        siteId: 'site-uuid-123',
        branchId: 'branch-uuid-789',
        path: 'pages/nouveau',
        locale: 'not a locale',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toBeInstanceOf(InvalidLocaleError);

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts a locale no market names', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [docRow({ locale: 'cy-GB' })] }) // INSERT document
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [versionRow()] }) // INSERT version
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/nouveau',
      locale: 'cy-GB',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const { params } = documentInsertCall(queryMock.mock.calls);
    expect(params).toContain('cy-GB');
  });

  it('leaves a reused document\'s locale as stored', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT document -> conflict, no row
      .mockResolvedValueOnce({ rows: [docRow({ id: 'existing-doc-id', locale: 'en' })] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [] }) // SELECT latest version on branch (none)
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [versionRow({ document_id: 'existing-doc-id' })] })
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/nouveau',
      locale: 'fr-FR',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(result.document.locale).toBe('en');
    const statements = queryMock.mock.calls.map((c) => c[0]);
    expect(statements.some((s) => typeof s === 'string' && s.includes('UPDATE app.documents'))).toBe(
      false,
    );
  });
});
