/**
 * Phase 3.1: Document Service Tests (TDD)
 *
 * Tests for Document CRUD operations.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { branchDocumentPaths, documents, documentVersions } from '../../src/db/schema';
import {
  createDocument,
  createDocumentOnBranch,
  deleteDocument,
  deleteDocumentOnBranch,
  documentExists,
  documentExistsOnBranch,
  DocumentNotFoundError,
  DuplicateDocumentPathError,
  getDocument,
  getDocumentByPath,
  InvalidDocumentPathError,
  listDocuments,
  listDocumentsOnBranch,
  resolveDocumentByPath,
  SiteNotFoundError,
  updateDocumentPath,
} from '../../src/services/document-service';

describe('Phase 3.1: Document Service', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  // Mock document row type (database format).
  // Type aliases rather than interfaces: the stub takes rows as
  // Record<string, unknown>, which an interface cannot satisfy because it
  // carries no implicit index signature.
  type MockDocumentRow = {
    id: string;
    site_id: string;
    path: string;
    created_at: string;
  };

  // Helper to create a mock document row (database format)
  function createMockDocumentRow(overrides: Partial<MockDocumentRow> = {}): MockDocumentRow {
    return {
      id: 'doc-uuid-123',
      site_id: 'site-uuid-456',
      path: 'pages/home',
      created_at: '2026-01-23T10:00:00.000Z',
      ...overrides,
    };
  }

  describe('createDocument', () => {
    it('should create a document with generated ID', async () => {
      const mockRow = createMockDocumentRow();
      stub.on(documents).insert.returnsRaw([mockRow]);

      const result = await createDocument({
        siteId: 'site-uuid-456',
        path: 'pages/home',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('doc-uuid-123');
      expect(result.siteId).toBe('site-uuid-456');
      expect(result.path).toBe('pages/home');
      expect(result.createdAt).toBeDefined();
    });

    it('should throw SiteNotFoundError when site does not exist', async () => {
      // Simulate foreign key violation
      const error = new Error('violates foreign key constraint');
      (error as NodeJS.ErrnoException).code = '23503';
      stub.on(documents).insert.rejects(error);

      await expect(
        createDocument({
          siteId: 'non-existent-site',
          path: 'pages/test',
        }),
      ).rejects.toThrow(SiteNotFoundError);
    });

    it('should throw DuplicateDocumentPathError for duplicate path in same site', async () => {
      // Simulate unique constraint violation
      const error = new Error('duplicate key value violates unique constraint');
      (error as NodeJS.ErrnoException).code = '23505';
      stub.on(documents).insert.rejects(error);

      await expect(
        createDocument({
          siteId: 'site-1',
          path: 'pages/existing',
        }),
      ).rejects.toThrow(DuplicateDocumentPathError);
    });

    it('should normalize empty path to root path', async () => {
      const mockRow = createMockDocumentRow({ path: '/' });
      stub.on(documents).insert.returnsRaw([mockRow]);

      const result = await createDocument({
        siteId: 'site-1',
        path: '',
      });

      expect(result.path).toBe('/');
    });

    it('should normalize path with leading slash', async () => {
      const mockDocRow = createMockDocumentRow({ path: 'pages/home' });
      stub.on(documents).insert.returnsRaw([mockDocRow]);

      const result = await createDocument({
        siteId: 'site-1',
        path: '/pages/home',
      });

      expect(result.path).toBe('pages/home');
      expect(stub.calls(documents).insert[0].params).toEqual(['site-1', 'pages/home']);
    });

    it('should normalize path with trailing slash', async () => {
      const mockDocRow = createMockDocumentRow({ path: 'pages/home' });
      stub.on(documents).insert.returnsRaw([mockDocRow]);

      const result = await createDocument({
        siteId: 'site-1',
        path: 'pages/home/',
      });

      expect(result.path).toBe('pages/home');
      expect(stub.calls(documents).insert[0].params).toEqual(['site-1', 'pages/home']);
    });

    it('should throw InvalidDocumentPathError for path with traversal sequence', async () => {

      await expect(
        createDocument({
          siteId: 'site-1',
          path: 'pages/../etc/passwd',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);
    });

    it('should throw InvalidDocumentPathError for path with double dots as complete segment', async () => {

      // ".." as a complete path segment should be rejected
      await expect(
        createDocument({
          siteId: 'site-1',
          path: '../pages',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);

      await expect(
        createDocument({
          siteId: 'site-1',
          path: 'pages/../home',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);
    });

    it('should allow filenames containing ".." that are not path traversal', async () => {
      const mockRow = createMockDocumentRow({
        path: '..hidden',
      });
      stub.on(documents).insert.returnsRaw([mockRow]);

      const result = await createDocument({
        siteId: 'site-1',
        path: '..hidden',
      });

      expect(result.path).toBe('..hidden');
    });

    it('should return created document with timestamp', async () => {
      const mockRow = createMockDocumentRow({
        created_at: '2026-01-23T15:30:00.000Z',
      });
      stub.on(documents).insert.returnsRaw([mockRow]);

      const result = await createDocument({
        siteId: 'site-1',
        path: 'components/header',
      });

      expect(result.createdAt).toBe('2026-01-23T15:30:00.000Z');
    });

    it('should execute INSERT query with correct parameters', async () => {
      const mockRow = createMockDocumentRow();
      stub.on(documents).insert.returnsRaw([mockRow]);

      await createDocument({
        siteId: 'site-abc',
        path: 'templates/main',
      });

      expect(stub.calls(documents).insert[0].params).toEqual(
        expect.arrayContaining(['site-abc', 'templates/main']),
      );
    });
  });

  describe('getDocument', () => {
    it('should return document when found', async () => {
      const mockRow = createMockDocumentRow({ id: 'doc-123' });
      stub.on(documents).select.returnsRaw([mockRow]);

      const result = await getDocument('doc-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('doc-123');
    });

    it('should return null when document not found', async () => {


      const result = await getDocument('non-existent');

      expect(result).toBeNull();
    });

    it('should query by document ID', async () => {


      await getDocument('doc-xyz');

      const [read] = stub.calls(documents).select;
      expect(read.sql).toContain('id');
      expect(read.params).toEqual(expect.arrayContaining(['doc-xyz']));
    });

    it('should map database row to Document type', async () => {
      const mockRow = createMockDocumentRow({
        id: 'doc-456',
        site_id: 'site-789',
        path: 'pages/about',
        created_at: '2026-01-20T08:00:00.000Z',
      });
      stub.on(documents).select.returnsRaw([mockRow]);

      const result = await getDocument('doc-456');

      expect(result).toMatchObject({
        id: 'doc-456',
        siteId: 'site-789',
        path: 'pages/about',
        createdAt: '2026-01-20T08:00:00.000Z',
      });
    });
  });

  describe('getDocumentByPath', () => {
    it('should return document when found by path', async () => {
      const mockRow = createMockDocumentRow({ path: 'pages/contact' });
      stub.on(documents).select.returnsRaw([mockRow]);

      const result = await getDocumentByPath('site-1', 'pages/contact');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('pages/contact');
    });

    it('should return null when path not found', async () => {


      const result = await getDocumentByPath('site-1', 'pages/non-existent');

      expect(result).toBeNull();
    });

    it('should normalize paths to lowercase for case-insensitive lookup', async () => {


      await getDocumentByPath('site-1', 'Pages/Home');

      // Should query with lowercase path
      expect(stub.calls(documents).select[0].params).toEqual(
        expect.arrayContaining(['site-1', 'pages/home']),
      );
    });

    it('should query by site_id and path', async () => {


      await getDocumentByPath('site-abc', 'components/footer');

      const [read] = stub.calls(documents).select;
      expect(read.sql).toMatch(/site_id[\s\S]*path|path[\s\S]*site_id/);
      expect(read.params).toEqual(expect.arrayContaining(['site-abc', 'components/footer']));
    });

    it('should not return archived documents', async () => {
      // Return empty result to simulate archived-only scenario


      const result = await getDocumentByPath('site-1', 'pages/archived');

      expect(result).toBeNull();
      // Verify query includes archived_at IS NULL filter
      expect(stub.calls(documents).select[0].sql).toContain('archived_at IS NULL');
    });

    // This is the hottest lookup in the system and every 404 runs it, so both
    // probes must stay index-seekable. COALESCE(bdp.path, d.path) = $2 reads
    // correctly but cannot use an index — it scans the whole site instead.
    describe('branch-scoped resolution stays indexed', () => {
      it('probes the override table by (branch_id, path) first', async () => {
        const mockRow = createMockDocumentRow({ path: 'aug13' });
        stub.on(branchDocumentPaths).select.returnsRaw([mockRow]);

        const result = await getDocumentByPath('site-1', 'august/aug13', 'branch-1');

        expect(stub.statements).toHaveLength(1);
        const [probe] = stub.calls(branchDocumentPaths).select;
        expect(probe.sql).toMatch(/bdp\.branch_id = \$\d/);
        expect(probe.sql).toMatch(/bdp\.path = \$\d/);
        expect(probe.params).toEqual(
          expect.arrayContaining(['site-1', 'august/aug13', 'branch-1']),
        );
        // The override path is the effective path, not the stored global one.
        expect(result?.path).toBe('august/aug13');
      });

      it('falls back to the global path guarded by NOT EXISTS when no override claims it', async () => {
        stub.on(branchDocumentPaths).select.returnsRaw([]);
        stub.on(documents).select.returnsRaw([createMockDocumentRow({ path: 'aug13' })]);

        const result = await getDocumentByPath('site-1', 'aug13', 'branch-1');

        expect(result?.path).toBe('aug13');
        const [fallback] = stub.calls(documents).select;
        expect(fallback.sql).toMatch(/d\.path = \$\d/);
        expect(fallback.sql).toMatch(/NOT EXISTS/);
      });

      it('never emits an unindexable COALESCE equality predicate', async () => {


        expect(await getDocumentByPath('site-1', 'aug13', 'branch-1')).toBeNull();

        for (const statement of stub.statements) {
          expect(statement.sql).not.toMatch(/COALESCE\([^)]*\)\s*=/);
        }
      });
    });
  });

  describe('resolveDocumentByPath', () => {
    it('returns not_found when no document exists at the path', async () => {
      // With a branchId the path lookup probes the override table, then the
      // global path; neither answers, so nothing is left to resolve.
      const result = await resolveDocumentByPath('site-1', 'pages/missing', 'branch-1');

      expect(result).toEqual({ status: 'not_found' });
    });

    it('returns found when the document exists and is not tombstoned on the branch', async () => {
      stub.on(branchDocumentPaths).select.returnsRaw([
        createMockDocumentRow({ path: 'pages/home' }),
      ]);

      const result = await resolveDocumentByPath('site-uuid-456', 'pages/home', 'branch-1');

      expect(result.status).toBe('found');
      if (result.status === 'found') {
        expect(result.document.id).toBe('doc-uuid-123');
      }
    });

    it('returns found for a CoW-inherited document with no local branch versions', async () => {
      // CoW-inherited: the global path answers, and the tombstone check finds
      // no version on the branch at all (MAX is null, so no row matches), which
      // must not be read as deleted.
      stub.on(documents).select.returnsRaw([createMockDocumentRow({ path: 'pages/inherited' })]);

      const result = await resolveDocumentByPath('site-uuid-456', 'pages/inherited', 'branch-1');

      expect(result.status).toBe('found');
      if (result.status === 'found') {
        expect(result.document.id).toBe('doc-uuid-123');
      }
    });

    it('returns deleted when the document exists but is tombstoned on the branch', async () => {
      stub.on(branchDocumentPaths).select.returnsRaw([
        createMockDocumentRow({ path: 'pages/gone' }),
      ]);
      stub.on(documentVersions).select.returnsRaw([{ one: 1 }]);

      const result = await resolveDocumentByPath('site-uuid-456', 'pages/gone', 'branch-1');

      expect(result.status).toBe('deleted');
      if (result.status === 'deleted') {
        expect(result.document.id).toBe('doc-uuid-123');
      }
    });

    it('returns found without a tombstone check when branchId is omitted', async () => {
      stub.on(documents).select.returnsRaw([createMockDocumentRow({ path: 'pages/home' })]);

      const result = await resolveDocumentByPath('site-uuid-456', 'pages/home');

      expect(result.status).toBe('found');
      expect(stub.statements).toHaveLength(1);
    });
  });

  describe('updateDocumentPath', () => {
    it('should update document path', async () => {
      const updatedRow = createMockDocumentRow({
        id: 'doc-123',
        path: 'pages/new-path',
      });
      stub.on('upd').select.returnsRaw([updatedRow]);

      const result = await updateDocumentPath('doc-123', 'pages/new-path');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('pages/new-path');
    });

    it('should throw DuplicateDocumentPathError when new path already exists', async () => {
      // Simulate unique constraint violation
      const error = new Error('duplicate key value violates unique constraint');
      (error as NodeJS.ErrnoException).code = '23505';
      stub.on('upd').select.rejects(error);

      await expect(
        updateDocumentPath('doc-123', 'pages/existing-path'),
      ).rejects.toThrow(DuplicateDocumentPathError);
    });

    it('should return null when document not found', async () => {
      const result = await updateDocumentPath('non-existent', 'pages/new');

      expect(result).toBeNull();
    });

    it('should normalize new path format', async () => {
      const updatedRow = createMockDocumentRow({ path: 'pages/updated' });
      stub.on('upd').select.returnsRaw([updatedRow]);

      await updateDocumentPath('doc-123', '/pages/updated/');

      expect(stub.calls('upd').select[0].params).toEqual(['pages/updated', 'doc-123']);
    });

    it('should execute UPDATE query', async () => {
      const updatedRow = createMockDocumentRow();
      stub.on('upd').select.returnsRaw([updatedRow]);

      await updateDocumentPath('doc-123', 'pages/updated');

      expect(stub.calls('upd').select[0].params).toEqual(
        expect.arrayContaining(['pages/updated', 'doc-123']),
      );
    });
  });

  describe('deleteDocument', () => {
    let stub: DatabaseStub;

    beforeEach(() => {
      stub = stubDatabase();
    });

    it('should delete document when found', async () => {

      stub.on(documents).delete.returns([{ id: 'doc-123' }]);

      const result = await deleteDocument('doc-123');

      expect(result).toBe(true);
    });

    it('should return false when document not found', async () => {

      const result = await deleteDocument('non-existent');

      expect(result).toBe(false);
    });

    it('should execute DELETE query', async () => {

      stub.on(documents).delete.returns([{ id: 'doc-to-delete' }]);

      await deleteDocument('doc-to-delete');

      const [call] = stub.calls(documents).delete;
      expect(call?.params).toEqual(['doc-to-delete']);
    });
  });

  describe('listDocuments', () => {
    it('should return all documents for a site', async () => {
      const mockRows = [
        createMockDocumentRow({ id: 'doc-1', path: 'pages/home' }),
        createMockDocumentRow({ id: 'doc-2', path: 'pages/about' }),
        createMockDocumentRow({ id: 'doc-3', path: 'components/header' }),
      ];
      stub.on(documents).select.returnsRaw(mockRows);

      const result = await listDocuments('site-1');

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('doc-1');
      expect(result[1].id).toBe('doc-2');
      expect(result[2].id).toBe('doc-3');
    });

    it('should support limit option', async () => {
      await listDocuments('site-1', { limit: 10 });

      const [read] = stub.calls(documents).select;
      expect(read.sql).toContain('LIMIT');
      expect(read.params).toEqual(expect.arrayContaining([10]));
    });

    it('should support offset option', async () => {
      await listDocuments('site-1', { offset: 20 });

      const [read] = stub.calls(documents).select;
      expect(read.sql).toContain('OFFSET');
      expect(read.params).toEqual(expect.arrayContaining([20]));
    });

    it('should support pathPrefix filter', async () => {
      const mockRows = [
        createMockDocumentRow({ path: 'pages/home' }),
        createMockDocumentRow({ path: 'pages/about' }),
      ];
      stub.on(documents).select.returnsRaw(mockRows);

      await listDocuments('site-1', { pathPrefix: 'pages/' });

      // The trailing slash bounds the match to the directory's contents.
      expect(stub.calls(documents).select[0].params).toEqual(
        expect.arrayContaining(['pages/%']),
      );
    });

    it('should escape LIKE wildcards in pathPrefix', async () => {
      // User input with SQL LIKE wildcards that should be escaped
      await listDocuments('site-1', { pathPrefix: 'pages/100%_discount' });

      expect(stub.calls(documents).select[0].params).toEqual(
        // % escaped to \%, _ escaped to \_
        expect.arrayContaining(['pages/100\\%\\_discount%']),
      );
    });

    it('should return empty array for empty site', async () => {
      const result = await listDocuments('empty-site');

      expect(result).toEqual([]);
    });

    it('should return empty array when no documents match pathPrefix', async () => {
      const result = await listDocuments('site-1', { pathPrefix: 'non-existent/' });

      expect(result).toEqual([]);
    });

    it('should filter by site_id', async () => {
      await listDocuments('specific-site-id');

      const [read] = stub.calls(documents).select;
      expect(read.sql).toContain('site_id');
      expect(read.params).toEqual(expect.arrayContaining(['specific-site-id']));
    });

    it('should map all rows to Document objects', async () => {
      const mockRows = [
        createMockDocumentRow({
          id: 'doc-1',
          site_id: 'site-abc',
          path: 'pages/test',
        }),
      ];
      stub.on(documents).select.returnsRaw(mockRows);

      const result = await listDocuments('site-abc');

      expect(result[0]).toMatchObject({
        id: 'doc-1',
        siteId: 'site-abc',
        path: 'pages/test',
      });
    });
  });

  describe('documentExists', () => {
    let stub: DatabaseStub;

    beforeEach(() => {
      stub = stubDatabase();
    });

    it('should return true when document exists', async () => {

      stub.on(documents).select.returnsRaw([{ one: 1 }]);

      const result = await documentExists('site-1', 'pages/home');

      expect(result).toBe(true);
    });

    it('should return false when document does not exist', async () => {

      const result = await documentExists('site-1', 'pages/non-existent');

      expect(result).toBe(false);
    });

    it('should check by site_id and path', async () => {

      await documentExists('site-xyz', 'components/widget');

      const [call] = stub.calls(documents).select;
      expect(call?.params).toEqual(expect.arrayContaining(['site-xyz', 'components/widget']));
    });
  });

  describe('Error Classes', () => {
    it('SiteNotFoundError should be an instance of Error', async () => {

      const error = new SiteNotFoundError('site-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('SiteNotFoundError');
      expect(error.siteId).toBe('site-123');
    });

    it('DuplicateDocumentPathError should include path and siteId', async () => {

      const error = new DuplicateDocumentPathError('pages/home', 'site-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('DuplicateDocumentPathError');
      expect(error.path).toBe('pages/home');
      expect(error.siteId).toBe('site-123');
    });

    it('InvalidDocumentPathError should include path and reason', async () => {

      const error = new InvalidDocumentPathError('path cannot be empty');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidDocumentPathError');
      expect(error.message).toContain('path cannot be empty');
    });
  });

  // =============================================================================
  // Branch-Scoped Document Operations (Phase 1)
  // =============================================================================

  describe('Branch-Scoped Document Operations', () => {
    // Mock document version row type (database format)
    type MockDocumentVersionRow = {
      id: string;
      document_id: string;
      branch_id: string;
      version_number: number;
      snapshot: Record<string, unknown>;
      source: string;
      created_by_id: string;
      created_by_type: 'user' | 'agent' | 'system';
      created_at: string;
      is_tombstone: boolean;
    };

    // Helper to create a mock document version row
    function createMockVersionRow(overrides: Partial<MockDocumentVersionRow> = {}): MockDocumentVersionRow {
      return {
        id: 'version-uuid-123',
        document_id: 'doc-uuid-123',
        branch_id: 'branch-uuid-456',
        version_number: 1,
        snapshot: {},
        source: 'edit',
        created_by_id: 'user-uuid-789',
        created_by_type: 'user',
        created_at: '2026-01-23T10:00:00.000Z',
        is_tombstone: false,
        ...overrides,
      };
    }

    describe('listDocumentsOnBranch', () => {
      it('should return documents that have versions on the branch', async () => {
        const mockRows = [
          createMockDocumentRow({ id: 'doc-1', path: 'pages/home' }),
          createMockDocumentRow({ id: 'doc-2', path: 'pages/about' }),
        ];
        stub.on('u').select.returnsRaw(mockRows);

        const result = await listDocumentsOnBranch('branch-uuid-456');

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('doc-1');
        expect(result[1].id).toBe('doc-2');
      });

      it('should filter by branchId in the query', async () => {
        await listDocumentsOnBranch('branch-abc-123');

        const [read] = stub.statements;
        expect(read.sql).toContain('branch_id');
        expect(read.params).toEqual(expect.arrayContaining(['branch-abc-123']));
      });

      it('should join with document_versions table', async () => {
        await listDocumentsOnBranch('branch-uuid-456');

        expect(stub.statements[0].sql).toMatch(/JOIN[\s\S]*app\.document_versions/i);
      });

      it('should exclude tombstoned documents', async () => {
        await listDocumentsOnBranch('branch-uuid-456');

        // Query should filter out documents with _deleted tombstone
        expect(stub.statements[0].sql).toMatch(/_deleted|tombstone/i);
      });

      it('should return empty array when no documents on branch', async () => {
        const result = await listDocumentsOnBranch('empty-branch');

        expect(result).toEqual([]);
      });

      it('should support pathPrefix option', async () => {
        await listDocumentsOnBranch('branch-uuid-456', { pathPrefix: 'pages/' });

        const [read] = stub.statements;
        expect(read.sql).toContain('LIKE');
        expect(read.params).toEqual(expect.arrayContaining(['pages/%']));
      });

      it('filters on the same prefix whether or not the branch inherits', async () => {
        await listDocumentsOnBranch('branch-uuid-456', { pathPrefix: '/Pages/' });
        await listDocumentsOnBranch('branch-feature-uuid', {
          pathPrefix: '/Pages/',
          mainBranchId: 'branch-main-uuid',
        });

        // An inheriting listing runs a different statement, not a different
        // filter: a prefix that answers one set on a branch cannot answer
        // another on main.
        const patterns = stub.statements.map(
          (statement) => statement.params.filter((param) => param === 'pages/%').length,
        );
        expect(patterns[0]).toBeGreaterThan(0);
        expect(patterns[1]).toBeGreaterThan(0);
      });

      it('should include main branch published documents when mainBranchId is provided', async () => {
        const mockRows = [
          createMockDocumentRow({ id: 'doc-branch-1', path: 'pages/local' }),
          createMockDocumentRow({ id: 'doc-main-1', path: 'pages/inherited' }),
        ];
        stub.on('u').select.returnsRaw(mockRows);

        const result = await listDocumentsOnBranch('branch-feature-uuid', {
          mainBranchId: 'branch-main-uuid',
        });

        expect(result).toHaveLength(2);
        // Query should use UNION to include main branch published docs
        const [read] = stub.statements;
        expect(read.sql).toMatch(/UNION/i);
        expect(read.params).toEqual(
          expect.arrayContaining(['branch-feature-uuid', 'branch-main-uuid']),
        );
      });

      it('should exclude documents tombstoned on branch even when published on main', async () => {
        // Only the non-tombstoned doc should be returned
        const mockRows = [
          createMockDocumentRow({ id: 'doc-main-1', path: 'pages/inherited' }),
        ];
        stub.on('u').select.returnsRaw(mockRows);

        const result = await listDocumentsOnBranch('branch-feature-uuid', {
          mainBranchId: 'branch-main-uuid',
        });

        expect(result).toHaveLength(1);
        // Query should exclude tombstoned documents from the UNION
        expect(stub.statements[0].sql).toMatch(/_deleted|tombstone/i);
      });

      it('should not duplicate documents that exist on both branch and main', async () => {
        // Document exists on both branch and main — should appear only once
        const mockRows = [
          createMockDocumentRow({ id: 'doc-shared-1', path: 'pages/home' }),
        ];
        stub.on('u').select.returnsRaw(mockRows);

        const result = await listDocumentsOnBranch('branch-feature-uuid', {
          mainBranchId: 'branch-main-uuid',
        });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('doc-shared-1');
        // Query should handle deduplication (e.g., via UNION which deduplicates, or EXCEPT/NOT IN)
        expect(stub.statements[0].sql).toMatch(/UNION|EXCEPT|NOT IN|NOT EXISTS/i);
      });

      it('should work without mainBranchId (backward compatible)', async () => {
        const mockRows = [
          createMockDocumentRow({ id: 'doc-1', path: 'pages/home' }),
        ];
        stub.on('u').select.returnsRaw(mockRows);

        const result = await listDocumentsOnBranch('branch-uuid-456');

        expect(result).toHaveLength(1);
        // Without mainBranchId, should NOT use UNION
        expect(stub.statements[0].sql).not.toMatch(/UNION/i);
      });
    });

    describe('createDocumentOnBranch', () => {
      it('should create a document and its initial version', async () => {
        const docRow = createMockDocumentRow({ id: 'new-doc-id', path: 'pages/new' });
        const versionRow = createMockVersionRow({ document_id: 'new-doc-id' });

        stub.on(documents).insert.returnsRaw([docRow]);
        stub.on(documentVersions).insert.returnsRaw([versionRow]);

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/new',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.document).toBeDefined();
        expect(result.document.id).toBe('new-doc-id');
        expect(result.version).toBeDefined();
      });

      it('should create version with empty snapshot by default', async () => {
        const docRow = createMockDocumentRow();
        const versionRow = createMockVersionRow({ snapshot: {} });

        stub.on(documents).insert.returnsRaw([docRow]);
        stub.on(documentVersions).insert.returnsRaw([versionRow]);

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/test',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.version.snapshot).toEqual({});
      });

      it('should reuse existing document if path already exists but no version on this branch', async () => {
        const existingDocRow = createMockDocumentRow({ id: 'existing-doc-id', path: 'pages/existing' });
        const versionRow = createMockVersionRow({ document_id: 'existing-doc-id' });

        stub.on(documents).insert.returnsRaw([]);
        stub.on(documents).select.returnsRaw([existingDocRow]);
        stub.on(documentVersions).insert.returnsRaw([versionRow]);

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/existing',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.document.id).toBe('existing-doc-id');
      });

      it('should throw DuplicateDocumentPathError if non-tombstoned version exists on branch', async () => {
        const existingDocRow = createMockDocumentRow({ id: 'existing-doc-id', path: 'pages/existing' });
        const existingVersionRow = createMockVersionRow({
          document_id: 'existing-doc-id',
          snapshot: { content: 'existing content' },
        });

        stub.on(documents).insert.returnsRaw([]);
        stub.on(documents).select.returnsRaw([existingDocRow]);
        stub.on(documentVersions).select.returnsRaw([existingVersionRow]);

        await expect(
          createDocumentOnBranch({
            siteId: 'site-uuid-456',
            branchId: 'branch-uuid-456',
            path: 'pages/existing',
            createdById: 'user-uuid-789',
            createdByType: 'user',
          }),
        ).rejects.toThrow(DuplicateDocumentPathError);
      });

      it('should recreate document fresh if latest version on branch is tombstoned', async () => {
        const existingDocRow = createMockDocumentRow({ id: 'existing-doc-id', path: 'pages/existing' });
        const tombstonedVersionRow = createMockVersionRow({
          document_id: 'existing-doc-id',
          version_number: 3,
          snapshot: { _deleted: true },
          is_tombstone: true,
        });
        // Prior versions on the branch (including the tombstone) are kept,
        // not deleted — see PCC-3938: a checkpoint can hold a NO ACTION FK to
        // any of them, and deleting threw a 500. The new version continues
        // the branch's sequence rather than resetting to 1.
        const newVersionRow = createMockVersionRow({
          document_id: 'existing-doc-id',
          version_number: 4,
          source: 'recreate',
        });

        stub.on(documents).insert.returnsRaw([]);
        stub.on(documents).select.returnsRaw([existingDocRow]);
        stub.on(documentVersions).select.returnsRaw([tombstonedVersionRow]);
        stub.on(documentVersions).insert.returnsRaw([newVersionRow]);

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/existing',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.document.id).toBe('existing-doc-id');
        expect(result.version.source).toBe('recreate');
        expect(result.version.versionNumber).toBe(4);
      });

      it('should throw SiteNotFoundError when site does not exist', async () => {
        // Simulate foreign key violation on document insert
        const fkError = new Error('violates foreign key constraint');
        (fkError as NodeJS.ErrnoException).code = '23503';

        stub.on(documents).insert.rejects(fkError);

        await expect(
          createDocumentOnBranch({
            siteId: 'non-existent-site',
            branchId: 'branch-uuid-456',
            path: 'pages/test',
            createdById: 'user-uuid-789',
            createdByType: 'user',
          }),
        ).rejects.toThrow(SiteNotFoundError);
      });

      it('should normalize path with leading slash', async () => {
        const mockDocRow = createMockDocumentRow({ path: 'pages/test' });
        const mockVersionRow = createMockVersionRow();

        stub.on(documents).insert.returnsRaw([mockDocRow]);
        stub.on(documentVersions).insert.returnsRaw([mockVersionRow]);

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: '/pages/test/',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.document.path).toBe('pages/test');
      });

      it('should set version source to edit', async () => {
        const docRow = createMockDocumentRow();
        const versionRow = createMockVersionRow({ source: 'edit' });

        stub.on(documents).insert.returnsRaw([docRow]);
        stub.on(documentVersions).insert.returnsRaw([versionRow]);

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/test',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.version.source).toBe('edit');
      });
    });

    describe('documentExistsOnBranch', () => {
      let stub: DatabaseStub;

      beforeEach(() => {
        stub = stubDatabase();
      });

      it('should return true when document has version on branch', async () => {

        stub.on(documentVersions).select.returnsRaw([{ one: 1 }]);

        const result = await documentExistsOnBranch('doc-uuid-123', 'branch-uuid-456');

        expect(result).toBe(true);
      });

      it('should return false when document has no version on branch', async () => {

        const result = await documentExistsOnBranch('doc-uuid-123', 'branch-uuid-456');

        expect(result).toBe(false);
      });

      it('should return false when document is tombstoned on branch', async () => {

        const result = await documentExistsOnBranch('tombstoned-doc', 'branch-uuid-456');

        expect(result).toBe(false);
        const [call] = stub.calls(documentVersions).select;
        expect(call?.sql).toMatch(/is_tombstone/i);
      });

      it('should check both documentId and branchId', async () => {

        await documentExistsOnBranch('doc-xyz', 'branch-abc');

        const [call] = stub.calls(documentVersions).select;
        expect(call?.params).toEqual(expect.arrayContaining(['doc-xyz', 'branch-abc']));
      });
    });

    describe('deleteDocumentOnBranch', () => {
      it('should create a tombstone version instead of deleting', async () => {
        const tombstoneRow = createMockVersionRow({ snapshot: { _deleted: true } });
        stub.on(documentVersions).insert.returnsRaw([tombstoneRow]);

        await deleteDocumentOnBranch({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          deletedById: 'user-uuid-789',
          deletedByType: 'user',
        });

        expect(stub.calls(documentVersions).insert[0].sql).toContain(
          'INSERT INTO app.document_versions',
        );
      });

      it('should set snapshot to { _deleted: true }', async () => {
        const tombstoneRow = createMockVersionRow({ snapshot: { _deleted: true } });
        stub.on(documentVersions).insert.returnsRaw([tombstoneRow]);

        await deleteDocumentOnBranch({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          deletedById: 'user-uuid-789',
          deletedByType: 'user',
        });

        // The tombstone marker rides in as the snapshot, which reaches the
        // statement as JSON text.
        const [insert] = stub.calls(documentVersions).insert;
        expect(insert.params).toContain(JSON.stringify({ _deleted: true }));
      });

      it('should return true when tombstone created successfully', async () => {
        const tombstoneRow = createMockVersionRow({ snapshot: { _deleted: true } });
        stub.on(documentVersions).insert.returnsRaw([tombstoneRow]);

        const result = await deleteDocumentOnBranch({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          deletedById: 'user-uuid-789',
          deletedByType: 'user',
        });

        expect(result).toBe(true);
      });

      it('should throw DocumentNotFoundError when document does not exist', async () => {
        // Simulate foreign key violation (document doesn't exist)
        const fkError = new Error('violates foreign key constraint');
        (fkError as NodeJS.ErrnoException).code = '23503';
        stub.on(documentVersions).insert.rejects(fkError);

        await expect(
          deleteDocumentOnBranch({
            documentId: 'non-existent',
            branchId: 'branch-uuid-456',
            deletedById: 'user-uuid-789',
            deletedByType: 'user',
          }),
        ).rejects.toThrow(DocumentNotFoundError);
      });

      it('should set source to edit for the tombstone version', async () => {
        const tombstoneRow = createMockVersionRow({ source: 'edit' });
        stub.on(documentVersions).insert.returnsRaw([tombstoneRow]);

        await deleteDocumentOnBranch({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          deletedById: 'user-uuid-789',
          deletedByType: 'user',
        });

        expect(stub.calls(documentVersions).insert[0].sql).toContain("'edit'");
      });
    });
  });
});
