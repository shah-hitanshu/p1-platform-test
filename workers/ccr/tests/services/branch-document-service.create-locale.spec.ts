/**
 * A document's locale is settable at creation, stored in the canonical form
 * validateLocale returns so one locale has one spelling in storage.
 *
 * Reusing an existing (site_id, path) is routine here — branch copy-on-write,
 * recreation after a tombstone, repeated registry syncs — and that path reads
 * the stored row rather than writing to it, so a create that names a locale
 * cannot relabel a document that already exists.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documents, documentVersions } from '../../src/db/schema';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { InvalidLocaleError } from '../../src/services/errors';

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

describe('createDocumentOnBranch locale', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  it('stores the locale in canonical form', async () => {
    stub.on(documents).insert.returnsRaw([docRow({ locale: 'he' })]);
    stub.on(documentVersions).insert.returnsRaw([versionRow()]);

    // `iw` is the deprecated tag for Hebrew; storage keeps the tag CLDR names.
    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/nouveau',
      locale: 'iw',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const [insert] = stub.calls(documents).insert;
    expect(insert.sql).toContain('locale');
    expect(insert.params).toContain('he');
  });

  it('inserts no locale when none is given', async () => {
    stub.on(documents).insert.returnsRaw([docRow()]);
    stub.on(documentVersions).insert.returnsRaw([versionRow()]);

    const result = await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/nouveau',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    void result;
    expect(stub.calls(documents).insert[0].params).toEqual([
      'site-uuid-123',
      'pages/nouveau',
      null,
    ]);
  });

  it('rejects a malformed language tag before writing anything', async () => {
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

    expect(stub.statements).toEqual([]);
  });

  it('accepts a locale no market names', async () => {
    stub.on(documents).insert.returnsRaw([docRow({ locale: 'cy-GB' })]);
    stub.on(documentVersions).insert.returnsRaw([versionRow()]);

    await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/nouveau',
      locale: 'cy-GB',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(stub.calls(documents).insert[0].params).toContain('cy-GB');
  });

  it('leaves a reused document\'s locale as stored', async () => {
    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow({ id: 'existing-doc-id', locale: 'en' })]);
    stub.on(documentVersions).insert.returnsRaw([
      versionRow({ document_id: 'existing-doc-id' }),
    ]);

    const result = await createDocumentOnBranch({
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-789',
      path: 'pages/nouveau',
      locale: 'fr-FR',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(result.document.locale).toBe('en');
    expect(stub.calls(documents).update).toEqual([]);
  });
});
