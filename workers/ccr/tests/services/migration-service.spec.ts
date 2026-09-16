/**
 * Phase 5: Migration Service Tests (TDD)
 *
 * Tests for template migration operations from PROPOSAL-010.
 * Handles automatic document updates when templates change, with conflict detection.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';
import { buildSlotDelta } from '../../src/services/slot-delta';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  documentRelations,
  documentVersions,
  documents,
  migrationConflicts,
  migrationJobs,
} from '../../src/db/schema';
import {
  applyDeltaToDocument,
  applyDeltaToSnapshot,
  detectDocumentConflicts,
  extractTemplateDelta,
  findAffectedDocuments,
  getMigrationJob,
  getMigrationStatus,
  listMigrationConflicts,
  previewMigration,
  processMigration,
  resolveMigrationConflict,
  rollbackMigration,
  triggerMigration,
} from '../../src/services/migration-service';
import {
  InvalidVersionRangeError,
  MigrationJobNotFoundError,
  TemplateNotFoundError,
} from '../../src/services/errors';
import { createCheckpoint, revertToCheckpoint } from '../../src/services/checkpoint-service';
import {
  createDocumentVersion,
  getLatestDocumentVersion,
  reconstructVersionSnapshot,
} from '../../src/services/document-version-service';
import { validateDocumentStructure } from '@pantheon-systems/p1-content-validator';

// Mock checkpoint service
vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
}));

// Mock document version service
vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersion: vi.fn(),
  createDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn().mockResolvedValue({ content: [] }),
}));

// Mock content validator
vi.mock('@pantheon-systems/p1-content-validator', () => ({
  validateDocumentStructure: vi.fn(),
}));

describe('Phase 5: Migration Service', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = stubDatabase();
  });

  // Mock types for database rows
  // Type aliases rather than interfaces: the stub takes rows as
  // Record<string, unknown>, which an interface cannot satisfy because it
  // carries no implicit index signature.
  type MockMigrationJobRow = {
    id: string;
    site_id: string;
    branch_id: string;
    template_id: string;
    from_version: number;
    to_version: number;
    checkpoint_id: string | null;
    status: 'pending' | 'in_progress' | 'completed' | 'completed_with_conflicts' | 'failed';
    total_documents: number;
    processed_documents: number;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
    completed_at: string | null;
  };

  type MockMigrationConflictRow = {
    id: string;
    migration_job_id: string;
    document_id: string;
    branch_id: string;
    template_id: string;
    from_version: number;
    to_version: number;
    template_delta: unknown;
    document_actions: unknown;
    resolution: 'apply' | 'skip' | 'manual' | null;
    created_at: string;
    resolved_at: string | null;
  };

  interface MockDocumentRow {
    id: string;
    site_id: string;
    branch_id: string;
    path: string;
    template_id: string | null;
    template_version: number | null;
  }

  // Helper to create mock migration job
  function createMockMigrationJob(overrides: Partial<MockMigrationJobRow> = {}): MockMigrationJobRow {
    return {
      id: 'job-uuid-123',
      site_id: 'site-uuid-456',
      branch_id: 'branch-uuid-789',
      template_id: 'template-uuid-001',
      from_version: 1,
      to_version: 2,
      checkpoint_id: 'checkpoint-uuid-999',
      status: 'pending',
      total_documents: 10,
      processed_documents: 0,
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-06-08T10:00:00.000Z',
      completed_at: null,
      ...overrides,
    };
  }

  // Helper to create mock document
  function createMockDocument(overrides: Partial<MockDocumentRow> = {}): MockDocumentRow {
    return {
      id: 'doc-uuid-123',
      site_id: 'site-uuid-456',
      branch_id: 'branch-uuid-789',
      path: 'pages/home',
      template_id: 'template-uuid-001',
      template_version: 1,
      ...overrides,
    };
  }

  // Helper to create mock migration conflict row
  function createMockConflictRow(overrides: Partial<MockMigrationConflictRow> = {}): MockMigrationConflictRow {
    return {
      id: 'conflict-uuid-001',
      migration_job_id: 'job-uuid-123',
      document_id: 'doc-uuid-123',
      branch_id: 'branch-uuid-789',
      template_id: 'template-uuid-001',
      from_version: 1,
      to_version: 2,
      template_delta: { added: [], removed: [], moved: [], templateIds: [] },
      document_actions: { added: [], removed: [], moved: [], templateIds: [] },
      resolution: null,
      created_at: '2026-06-08T11:00:00.000Z',
      resolved_at: null,
      ...overrides,
    };
  }

  // =========================================================================
  describe('extractTemplateDelta: editor-private root props', () => {
    it('excludes editor-private root props (_template/_pinMap) from prop patches', async () => {

      const fromSnapshot = {
        content: [],
        root: { props: { _template: { label: 'Old', deprecated: false }, _pinMap: {} } },
        zones: {},
      };
      const toSnapshot = {
        content: [],
        root: { props: { _template: { label: 'New', deprecated: true }, _pinMap: { 'hero-1': true } } },
        zones: {},
      };
      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce(fromSnapshot)
        .mockResolvedValueOnce(toSnapshot);

      const result = await extractTemplateDelta('template-uuid-001', 'branch-uuid-789', 1, 2);

      expect(result.propPatches).toEqual([]);
    });

    it('propagates a non-underscore root prop change as a __root__ patch', async () => {

      const fromSnapshot = {
        content: [],
        root: { props: { title: 'Old Title', _template: { label: 'X', deprecated: false } } },
        zones: {},
      };
      const toSnapshot = {
        content: [],
        root: { props: { title: 'New Title', _template: { label: 'X', deprecated: false } } },
        zones: {},
      };
      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce(fromSnapshot)
        .mockResolvedValueOnce(toSnapshot);

      const result = await extractTemplateDelta('template-uuid-001', 'branch-uuid-789', 1, 2);

      const rootPatch = result.propPatches.find((p) => p.componentId === '__root__');
      expect(rootPatch).toBeDefined();
      expect(rootPatch?.operations).toEqual([
        { op: 'replace', path: '/title', value: 'New Title' },
      ]);
    });

    it('propagates only the non-underscore key when a root change mixes both', async () => {

      const fromSnapshot = {
        content: [],
        root: { props: { title: 'Old', _pinMap: {} } },
        zones: {},
      };
      const toSnapshot = {
        content: [],
        root: { props: { title: 'New', _pinMap: { 'hero-1': true } } },
        zones: {},
      };
      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce(fromSnapshot)
        .mockResolvedValueOnce(toSnapshot);

      const result = await extractTemplateDelta('template-uuid-001', 'branch-uuid-789', 1, 2);

      const rootPatch = result.propPatches.find((p) => p.componentId === '__root__');
      expect(rootPatch?.operations).toEqual([
        { op: 'replace', path: '/title', value: 'New' },
      ]);
      expect(rootPatch?.operations.some((op) => op.path.includes('_pinMap'))).toBe(false);
    });
  });
  // getMigrationJob
  // =========================================================================

  describe('getMigrationJob', () => {
    it('should return a migration job by ID', async () => {

      stub.on(migrationJobs).select.returnsRaw([createMockMigrationJob()]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);

      const result = await getMigrationJob('job-uuid-123');

      expect(result.id).toBe('job-uuid-123');
      expect(result.siteId).toBe('site-uuid-456');
      expect(result.branchId).toBe('branch-uuid-789');
      expect(result.templateId).toBe('template-uuid-001');
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(2);
      expect(result.status).toBe('pending');
      expect(result.totalDocuments).toBe(10);
      expect(result.processedDocuments).toBe(0);
      expect(result.checkpointId).toBe('checkpoint-uuid-999');
    });

    it('should throw MigrationJobNotFoundError when job does not exist', async () => {

      await expect(getMigrationJob('nonexistent-job')).rejects.toThrow(MigrationJobNotFoundError);
    });

    it('should query the migration_jobs table with the correct job ID', async () => {

      stub.on(migrationJobs).select.returnsRaw([createMockMigrationJob()]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);

      await getMigrationJob('job-uuid-123');

      const calls = stub.calls(migrationJobs).select;
      expect(calls).toHaveLength(1);
      expect(calls[0]?.params).toEqual(['job-uuid-123']);
    });
  });

  // =========================================================================
  // listMigrationConflicts
  // =========================================================================

  describe('listMigrationConflicts', () => {
    it('should return all conflicts for a migration job', async () => {

      const mockConflicts = [
        createMockConflictRow({ id: 'conflict-1', document_id: 'doc-1' }),
        createMockConflictRow({ id: 'conflict-2', document_id: 'doc-2' }),
      ];

      stub.on(migrationConflicts).select.returnsRaw(mockConflicts);

      const result = await listMigrationConflicts('job-uuid-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('conflict-1');
      expect(result[0].documentId).toBe('doc-1');
      expect(result[1].id).toBe('conflict-2');
      expect(result[1].documentId).toBe('doc-2');
    });

    it('should return empty array when no conflicts exist', async () => {

      const result = await listMigrationConflicts('job-uuid-123');

      expect(result).toEqual([]);
    });

    it('should query migration_conflicts by migration_job_id', async () => {

      await listMigrationConflicts('job-uuid-123');

      const calls = stub.calls(migrationConflicts).select;
      expect(calls).toHaveLength(1);
      expect(calls[0]?.params).toEqual(['job-uuid-123']);
    });
  });

  // =========================================================================
  // findAffectedDocuments
  // =========================================================================

  describe('findAffectedDocuments', () => {
    it('should return paginated documents with snapshots', async () => {

      const mockDocRows = [
        {
          ...createMockDocument({ id: 'doc-1', path: 'pages/home', template_version: 1 }),
          snapshot: { content: [{ type: 'Hero' }], root: {}, zones: {} },
        },
        {
          ...createMockDocument({ id: 'doc-2', path: 'pages/about', template_version: 1 }),
          snapshot: { content: [{ type: 'Header' }], root: {}, zones: {} },
        },
      ];

      stub.on(documents).select.returnsRaw(mockDocRows);

      const result = await findAffectedDocuments(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        2,
        50,
        0,
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('doc-1');
      expect(result[0].path).toBe('pages/home');
      expect(result[0].snapshot).toBeDefined();
      expect(result[1].id).toBe('doc-2');
    });

    it('should filter documents by template_id and version < toVersion', async () => {

      await findAffectedDocuments(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        3,
        50,
        0,
      );

      expect(stub.statements).toHaveLength(1);
      const [listing] = stub.calls(documents).select;
      // Should filter by template_id and template_version < toVersion
      expect(listing.sql).toContain('template_id');
      expect(listing.sql).toContain('template_version');
      // Parameters should include branchId, templateId, toVersion, limit, offset
      expect(listing.params).toEqual(
        expect.arrayContaining(['branch-uuid-789', 'template-uuid-001']),
      );
    });

    it('should apply LIMIT and OFFSET for pagination', async () => {

      await findAffectedDocuments(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        2,
        50,
        100,
      );

      expect(stub.statements).toHaveLength(1);
      const [listing] = stub.calls(documents).select;
      expect(listing.sql.toUpperCase()).toContain('LIMIT');
      expect(listing.sql.toUpperCase()).toContain('OFFSET');
      // limit and offset should be in the parameters
      expect(listing.params).toContain(50);
      expect(listing.params).toContain(100);
    });

    it('should return empty array when no documents are affected', async () => {

      const result = await findAffectedDocuments(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        2,
        50,
        0,
      );

      expect(result).toEqual([]);
    });

    it('should include latest document version snapshot via JOIN', async () => {

      const mockDocRows = [
        {
          ...createMockDocument({ id: 'doc-1', template_version: 1 }),
          snapshot: { content: [{ type: 'Hero' }, { type: 'Footer' }], root: { props: {} }, zones: {} },
        },
      ];

      stub.on(documents).select.returnsRaw(mockDocRows);

      const result = await findAffectedDocuments(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        2,
        50,
        0,
      );

      expect(result[0].snapshot).toEqual({
        content: [{ type: 'Hero' }, { type: 'Footer' }],
        root: { props: {} },
        zones: {},
      });
    });
  });

  // =========================================================================
  // triggerMigration
  // =========================================================================

  describe('triggerMigration', () => {
    it('should validate fromVersion < toVersion', async () => {

      await expect(
        triggerMigration(
          'site-uuid-456',
          'branch-uuid-789',
          'template-uuid-001',
          3,
          2,
          { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow(InvalidVersionRangeError);
    });

    it('should throw InvalidVersionRangeError when fromVersion equals toVersion', async () => {

      await expect(
        triggerMigration(
          'site-uuid-456',
          'branch-uuid-789',
          'template-uuid-001',
          2,
          2,
          { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow(InvalidVersionRangeError);
    });

    it('should verify template exists and throw TemplateNotFoundError if missing', async () => {

      // Template lookup returns no rows
      await expect(
        triggerMigration(
          'site-uuid-456',
          'branch-uuid-789',
          'nonexistent-template',
          1,
          2,
          { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow(TemplateNotFoundError);
    });

    it('should create pre_migration checkpoint', async () => {

      // Template exists, and five documents are bound to it. Both read the
      // documents table; the count is told apart by what it asks for.
      stub.on(documents).select.whenAsking(/COUNT/).returnsRaw([{ count: '5' }]);
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      // Checkpoint creation
      vi.mocked(createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-uuid-999',
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_migration',
          createdById: 'user-uuid-001',
          createdByType: 'user',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        documentCount: 5,
      });

      // Insert migration_jobs record
      const mockJobRow = createMockMigrationJob({
        checkpoint_id: 'checkpoint-uuid-999',
        total_documents: 5,
      });
      stub.on(migrationJobs).insert.returnsRaw([mockJobRow]);

      await triggerMigration(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        1,
        2,
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(createCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_migration',
        }),
      );
    });

    it('should create migration_job record with checkpoint reference', async () => {

      // Template exists, and the count says how many documents are bound
      // to it. Both read the documents table; the count is told apart by
      // what it asks for.
      stub.on(documents).select.whenAsking(/COUNT/).returnsRaw([{ count: '10' }]);
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      // Checkpoint
      vi.mocked(createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-uuid-999',
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_migration',
          createdById: 'user-uuid-001',
          createdByType: 'user',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        documentCount: 10,
      });

      // Insert migration job
      const mockJobRow = createMockMigrationJob({
        checkpoint_id: 'checkpoint-uuid-999',
        total_documents: 10,
      });
      stub.on(migrationJobs).insert.returnsRaw([mockJobRow]);

      const result = await triggerMigration(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        1,
        2,
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.checkpointId).toBe('checkpoint-uuid-999');
      expect(result.status).toBe('pending');
    });

    it('should count total affected documents', async () => {

      // Template exists, and the count says how many documents are bound
      // to it. Both read the documents table; the count is told apart by
      // what it asks for.
      stub.on(documents).select.whenAsking(/COUNT/).returnsRaw([{ count: '15' }]);
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      // Checkpoint
      vi.mocked(createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-uuid-999',
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_migration',
          createdById: 'user-uuid-001',
          createdByType: 'user',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        documentCount: 15,
      });

      // Insert migration job
      const mockJobRow = createMockMigrationJob({ total_documents: 15 });
      stub.on(migrationJobs).insert.returnsRaw([mockJobRow]);

      const result = await triggerMigration(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        1,
        2,
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.totalDocuments).toBe(15);
    });

    it('should return the created migration job', async () => {

      // Template exists, and the count says how many documents are bound
      // to it. Both read the documents table; the count is told apart by
      // what it asks for.
      stub.on(documents).select.whenAsking(/COUNT/).returnsRaw([{ count: '3' }]);
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      // Checkpoint
      vi.mocked(createCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-uuid-999',
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_migration',
          createdById: 'user-uuid-001',
          createdByType: 'user',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        documentCount: 3,
      });

      // Insert migration job
      const mockJobRow = createMockMigrationJob({
        total_documents: 3,
        from_version: 1,
        to_version: 2,
      });
      stub.on(migrationJobs).insert.returnsRaw([mockJobRow]);

      const result = await triggerMigration(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        1,
        2,
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.id).toBeDefined();
      expect(result.siteId).toBe('site-uuid-456');
      expect(result.branchId).toBe('branch-uuid-789');
      expect(result.templateId).toBe('template-uuid-001');
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(2);
      expect(result.totalDocuments).toBe(3);
      expect(result.processedDocuments).toBe(0);
    });
  });

  // =========================================================================
  // processMigration
  // =========================================================================

  describe('processMigration', () => {
    it('should process clean documents without conflicts', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 1 });
      const docSnapshot = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }], root: { props: {} }, zones: {} };

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);
      stub.on(documents).select.returnsRaw([{ ...createMockDocument({ id: 'doc-1', template_version: 1 }), snapshot: docSnapshot }]);
      // A migrated document stops matching the listing, which is what ends
      // the paging loop; the notification is where that becomes true.
      const migrated = (): Promise<void> => {
        stub.on(documents).select.returnsRaw([]);
        return Promise.resolve();
      };

      // Template is unchanged across versions and the document is untouched since
      // its baseline, so the delta is empty and no slot conflicts.
      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string) =>
        Promise.resolve(id === 'template-uuid-001'
          ? { content: [{ type: 'Hero', props: { id: 'Hero-a' } }], root: { props: {} }, zones: {} }
          : docSnapshot),
      );

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-100', documentId: 'doc-1', branchId: 'branch-uuid-789', versionNumber: 3,
        snapshot: docSnapshot, source: 'edit', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-101', documentId: 'doc-1', branchId: 'branch-uuid-789', versionNumber: 4,
        snapshot: docSnapshot, source: 'migration', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      const result = await processMigration('job-uuid-123', migrated);

      expect(result.processedDocuments).toBeGreaterThanOrEqual(1);
      expect(result.conflictedDocuments).toBe(0);
    });

    it('routes a document to migration_conflicts when it and the template touched the same slot id', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 1 });
      const templateFrom = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const templateTo = { content: [{ type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const docBaseline = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      // Editor removed Hero-a, the same slot the template removed.
      const docCurrent = { content: [{ type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);
      // A conflicted document stays in the listing, so the run advances its
      // offset past this page and the next read comes back empty.
      stub.on(documents).select.whenBound([0]).returnsRaw([{ ...createMockDocument({ id: 'doc-conflicted', template_version: 1 }), snapshot: docCurrent }]);

      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string, _branch: string, version: number) => {
        if (id === 'template-uuid-001') return Promise.resolve(version === 1 ? templateFrom : templateTo);
        return Promise.resolve(docBaseline);
      });

      const result = await processMigration('job-uuid-123');

      expect(result.conflictedDocuments).toBeGreaterThanOrEqual(1);
      expect(stub.calls(migrationConflicts).insert).not.toEqual([]);
    });

    it('should update processed_documents counter incrementally', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 1 });
      const docSnapshot = { content: [], root: { props: {} }, zones: {} };

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);
      stub.on(documents).select.returnsRaw([{ ...createMockDocument({ id: 'doc-1', template_version: 1 }), snapshot: docSnapshot }]);
      // A migrated document stops matching the listing, which is what ends
      // the paging loop; the notification is where that becomes true.
      const migrated = (): Promise<void> => {
        stub.on(documents).select.returnsRaw([]);
        return Promise.resolve();
      };

      vi.mocked(reconstructVersionSnapshot).mockResolvedValue(docSnapshot);
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-100', documentId: 'doc-1', branchId: 'branch-uuid-789', versionNumber: 1,
        snapshot: docSnapshot, source: 'edit', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-101', documentId: 'doc-1', branchId: 'branch-uuid-789', versionNumber: 2,
        snapshot: docSnapshot, source: 'migration', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      await processMigration('job-uuid-123', migrated);

      const progressUpdate = stub.calls(migrationJobs).update.find(
        (call) => call.sql.toLowerCase().includes('processed_documents'),
      );
      expect(progressUpdate).toBeDefined();
    });

    it('should mark job completed when all documents processed', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 0 });

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);

      const result = await processMigration('job-uuid-123');

      const completed = stub.calls(migrationJobs).update.find(
        (call) => call.params.includes('completed'),
      );
      expect(completed).toBeDefined();
      expect(result.processedDocuments).toBe(0);
      expect(result.conflictedDocuments).toBe(0);
    });

    it('should process in batches of 50 documents', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 0 });

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);

      await processMigration('job-uuid-123');

      const listing = stub.calls(documents).select.find(
        (call) => call.sql.toUpperCase().includes('LIMIT'),
      );
      expect(listing?.params).toContain(50);
    });

    it('should set job status to in_progress before processing', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 0 });

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);

      await processMigration('job-uuid-123');

      const claim = stub.calls(migrationJobs).update.find(
        (call) => call.params.includes('in_progress'),
      );
      expect(claim).toBeDefined();
    });

    it('reconstructs the baseline snapshot when the latest document version stores no snapshot', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 1 });
      const docSnapshot = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);
      stub.on(documents).select.returnsRaw([{ ...createMockDocument({ id: 'doc-crdt', template_version: 1 }), snapshot: docSnapshot }]);
      // A migrated document stops matching the listing, which is what ends
      // the paging loop; the notification is where that becomes true.
      const migrated = (): Promise<void> => {
        stub.on(documents).select.returnsRaw([]);
        return Promise.resolve();
      };

      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string) =>
        Promise.resolve(id === 'template-uuid-001'
          ? { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} }
          : docSnapshot),
      );

      // Latest version carries a null snapshot, so applyDeltaToDocument reconstructs it.
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-200', documentId: 'doc-crdt', branchId: 'branch-uuid-789', versionNumber: 3,
        snapshot: null as unknown as Record<string, unknown>,
        source: 'edit' as DocumentVersionSource, createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-201', documentId: 'doc-crdt', branchId: 'branch-uuid-789', versionNumber: 4,
        snapshot: docSnapshot, source: 'migration',
        createdById: 'user-uuid-001', createdByType: 'user', createdAt: '2026-06-18T10:01:00.000Z',
      });

      const result = await processMigration('job-uuid-123', migrated);

      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(0);
      expect(reconstructVersionSnapshot).toHaveBeenCalledWith('doc-crdt', 'branch-uuid-789', 3);
      expect(createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'migration' }),
      );
    });

    it('should record conflict when document snapshot cannot be reconstructed', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 1 });

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);
      // A conflicted document stays in the listing, so the run advances its
      // offset past this page and the next read comes back empty.
      stub.on(documents).select.whenBound([0]).returnsRaw([{ ...createMockDocument({ id: 'doc-broken', template_version: 1 }), snapshot: null }]);

      // Every reconstruction returns null: the baseline diff sees no document
      // change (clean) but applyDeltaToDocument then fails and the doc is recorded.
      vi.mocked(reconstructVersionSnapshot).mockResolvedValue(null);
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-300', documentId: 'doc-broken', branchId: 'branch-uuid-789', versionNumber: 2,
        snapshot: null as unknown as Record<string, unknown>,
        source: 'edit' as DocumentVersionSource, createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
      });

      const result = await processMigration('job-uuid-123');

      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(1);
      expect(stub.calls(migrationConflicts).insert).not.toEqual([]);
    });
  });

  // =========================================================================
  // rollbackMigration
  // =========================================================================

  describe('rollbackMigration', () => {
    it('should revert using checkpoint when checkpoint_id exists', async () => {

      const mockJob = createMockMigrationJob({
        checkpoint_id: 'checkpoint-uuid-999',
        status: 'completed',
        total_documents: 5,
      });

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);

      // revertToCheckpoint
      vi.mocked(revertToCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-uuid-999',
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_migration',
          createdById: 'user-uuid-001',
          createdByType: 'user',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        documentsReverted: 5,
      });

      // Reset template_version on affected docs
      // Mark job as 'failed'
      const result = await rollbackMigration(
        'job-uuid-123',
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(revertToCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          checkpointId: 'checkpoint-uuid-999',
        }),
      );
      expect(result.rolledBackDocuments).toBeGreaterThanOrEqual(0);
    });

    it('should throw MigrationJobNotFoundError when job does not exist', async () => {

      await expect(
        rollbackMigration(
          'nonexistent-job',
          { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow(MigrationJobNotFoundError);
    });

    it('should restore the synced template version on affected documents', async () => {

      const mockJob = createMockMigrationJob({
        checkpoint_id: 'checkpoint-uuid-999',
        from_version: 1,
        to_version: 2,
      });

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);

      // revertToCheckpoint
      vi.mocked(revertToCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-uuid-999',
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_migration',
          createdById: 'user-uuid-001',
          createdByType: 'user',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        documentsReverted: 3,
      });

      await rollbackMigration(
        'job-uuid-123',
        { id: 'user-uuid-001', type: 'user' },
      );

      // Verify synced_version was reset on the template edges
      const resetStatement = stub.statements.find(({ sql }) => {
        const text = sql.toLowerCase();
        return text.includes('synced_version')
          && text.includes('update')
          && text.includes('document_relations');
      });
      expect(resetStatement).toBeDefined();
    });

    it('should mark job as failed', async () => {

      const mockJob = createMockMigrationJob({
        checkpoint_id: 'checkpoint-uuid-999',
      });

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);

      // revertToCheckpoint
      vi.mocked(revertToCheckpoint).mockResolvedValueOnce({
        checkpoint: {
          id: 'checkpoint-uuid-999',
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_migration',
          createdById: 'user-uuid-001',
          createdByType: 'user',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        documentsReverted: 2,
      });

      await rollbackMigration(
        'job-uuid-123',
        { id: 'user-uuid-001', type: 'user' },
      );

      // Verify job was marked as 'failed'
      const [failedUpdate] = stub.calls(migrationJobs).update;
      expect(failedUpdate?.params).toContain('failed');
    });

    it('should handle rollback when no checkpoint exists (legacy path)', async () => {

      const mockJob = createMockMigrationJob({
        checkpoint_id: null,
        from_version: 1,
        to_version: 2,
      });

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);

      // Delete migration versions (legacy path)
      // Reset template_version on affected docs
      // Mark job as 'failed'
      await rollbackMigration(
        'job-uuid-123',
        { id: 'user-uuid-001', type: 'user' },
      );

      // revertToCheckpoint should NOT be called when checkpoint_id is null
      expect(revertToCheckpoint).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // resolveMigrationConflict
  // =========================================================================

  describe('resolveMigrationConflict', () => {
    it('should apply delta when resolution is "apply"', async () => {

      const conflictRow = createMockConflictRow();

      // Unlocked read to build the apply plan, then the locked re-read.
      stub.on(migrationConflicts).select.returnsRaw([conflictRow]);

      // applyDeltaToDocument flow:
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-100', documentId: 'doc-uuid-123', branchId: 'branch-uuid-789',
        versionNumber: 3, snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
        source: 'edit', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });

      vi.mocked(validateDocumentStructure).mockReturnValueOnce({ errors: [] });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-101', documentId: 'doc-uuid-123', branchId: 'branch-uuid-789',
        versionNumber: 4, snapshot: { content: [{ type: 'Body' }, { type: 'Hero' }], root: {}, zones: {} },
        source: 'migration', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      // Update documents.template_version
      // Update conflict: set resolution='apply', resolved_at
      const resolvedConflict = createMockConflictRow({
        resolution: 'apply',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      stub.on(migrationConflicts).update.returnsRaw([resolvedConflict]);

      const result = await resolveMigrationConflict(
        'conflict-uuid-001',
        'apply',
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.resolution).toBe('apply');
      expect(result.resolvedAt).toBeDefined();
    });

    it('should record resolution only when strategy is "skip"', async () => {

      const conflictRow = createMockConflictRow();

      stub.on(migrationConflicts).select.returnsRaw([conflictRow]);

      // Update conflict: set resolution='skip', resolved_at
      const resolvedConflict = createMockConflictRow({
        resolution: 'skip',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      stub.on(migrationConflicts).update.returnsRaw([resolvedConflict]);

      const result = await resolveMigrationConflict(
        'conflict-uuid-001',
        'skip',
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.resolution).toBe('skip');
      // createDocumentVersion should NOT be called for 'skip'
      expect(createDocumentVersion).not.toHaveBeenCalled();
    });

    it('should record resolution only when strategy is "manual"', async () => {

      const conflictRow = createMockConflictRow();

      stub.on(migrationConflicts).select.returnsRaw([conflictRow]);

      // Update conflict: set resolution='manual', resolved_at
      const resolvedConflict = createMockConflictRow({
        resolution: 'manual',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      stub.on(migrationConflicts).update.returnsRaw([resolvedConflict]);

      const result = await resolveMigrationConflict(
        'conflict-uuid-001',
        'manual',
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.resolution).toBe('manual');
      // createDocumentVersion should NOT be called for 'manual'
      expect(createDocumentVersion).not.toHaveBeenCalled();
    });

    it('should update resolved_at timestamp on resolution', async () => {

      const conflictRow = createMockConflictRow();

      stub.on(migrationConflicts).select.returnsRaw([conflictRow]);

      // Update conflict with resolved_at
      const resolvedConflict = createMockConflictRow({
        resolution: 'skip',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      stub.on(migrationConflicts).update.returnsRaw([resolvedConflict]);

      const result = await resolveMigrationConflict(
        'conflict-uuid-001',
        'skip',
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.resolvedAt).not.toBeNull();

      // Verify the update query sets resolved_at
      const updateCall = stub.calls(migrationConflicts).update.find(
        (call) => call.sql.toLowerCase().includes('resolved_at'),
      );
      expect(updateCall).toBeDefined();
    });

    it('should update the synced template version on apply resolution', async () => {

      const conflictRow = createMockConflictRow({
        from_version: 1,
        to_version: 2,
      });

      // Unlocked read to build the apply plan, then the locked re-read.
      stub.on(migrationConflicts).select.returnsRaw([conflictRow]);

      // applyDeltaToDocument flow
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-100', documentId: 'doc-uuid-123', branchId: 'branch-uuid-789',
        versionNumber: 3, snapshot: { content: [{ type: 'Hero' }], root: {}, zones: {} },
        source: 'edit', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });

      vi.mocked(validateDocumentStructure).mockReturnValueOnce({ errors: [] });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-101', documentId: 'doc-uuid-123', branchId: 'branch-uuid-789',
        versionNumber: 4, snapshot: { content: [{ type: 'Hero' }, { type: 'Footer' }], root: {}, zones: {} },
        source: 'migration', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      // Update the template edge's synced_version
      // Update conflict record
      const resolvedConflict = createMockConflictRow({
        resolution: 'apply',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      stub.on(migrationConflicts).update.returnsRaw([resolvedConflict]);

      await resolveMigrationConflict(
        'conflict-uuid-001',
        'apply',
        { id: 'user-uuid-001', type: 'user' },
      );

      // Verify the template edge's synced_version was updated
      const templateVersionCall = stub.calls(documentRelations).update.find(
        (call) => call.sql.toLowerCase().includes('synced_version'),
      );
      expect(templateVersionCall).toBeDefined();
    });
  });

  // =========================================================================
  // getMigrationStatus
  // =========================================================================

  describe('getMigrationStatus', () => {
    it('should return migration status with stale documents', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 5 }]);
      stub.on(documents).select.returnsRaw([{ count: '12', oldest_version: 2 }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.currentVersion).toBe(5);
      expect(result.staleDocumentCount).toBe(12);
      expect(result.oldestDocumentVersion).toBe(2);
      expect(result.migrationAvailable).toBe(true);
    });

    it('should return migrationAvailable: false when no stale documents', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(documents).select.returnsRaw([{ count: '0', oldest_version: null }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.staleDocumentCount).toBe(0);
      expect(result.oldestDocumentVersion).toBeNull();
      expect(result.migrationAvailable).toBe(false);
    });

    it('should throw TemplateNotFoundError when template does not exist', async () => {

      // Template version lookup returns no rows
      await expect(
        getMigrationStatus('nonexistent-template', 'branch-uuid-789'),
      ).rejects.toThrow(TemplateNotFoundError);
    });

    it('should handle documents with null template_version', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 1 }]);
      stub.on(documents).select.returnsRaw([{ count: '3', oldest_version: null }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.staleDocumentCount).toBe(3);
      expect(result.oldestDocumentVersion).toBeNull();
      expect(result.migrationAvailable).toBe(true);
    });
  });

  // =========================================================================
  // getMigrationStatus - activeMigration
  // =========================================================================

  describe('getMigrationStatus activeMigration', () => {
    it('should report activeMigration as null when there are no jobs', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 5 }]);
      stub.on(documents).select.returnsRaw([{ count: '2', oldest_version: 1 }]);
      // Latest job lookup: no jobs
      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.activeMigration).toBeNull();
    });

    it('should report progress when the latest job is running', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 5 }]);
      stub.on(documents).select.returnsRaw([{ count: '7', oldest_version: 2 }]);
      // Latest job lookup: in_progress
      stub.on(migrationJobs).select.returnsRaw([createMockMigrationJob({
        id: 'job-uuid-running',
        status: 'in_progress',
        total_documents: 10,
        processed_documents: 4,
      })]);
      stub.on(migrationConflicts).select.returnsRaw([{ value: 0 }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.activeMigration).toEqual({
        jobId: 'job-uuid-running',
        status: 'in_progress',
        processedDocuments: 4,
        totalDocuments: 10,
        unresolvedConflicts: 0,
      });
    });

    it('should report progress when the latest job is pending', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 5 }]);
      stub.on(documents).select.returnsRaw([{ count: '7', oldest_version: 2 }]);
      stub.on(migrationJobs).select.returnsRaw([createMockMigrationJob({
        id: 'job-uuid-pending',
        status: 'pending',
        total_documents: 10,
        processed_documents: 0,
      })]);
      stub.on(migrationConflicts).select.returnsRaw([{ value: 0 }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.activeMigration?.jobId).toBe('job-uuid-pending');
      expect(result.activeMigration?.status).toBe('pending');
    });

    it('should surface a completed_with_conflicts job with unresolved conflicts', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 5 }]);
      stub.on(documents).select.returnsRaw([{ count: '3', oldest_version: 1 }]);
      stub.on(migrationJobs).select.returnsRaw([createMockMigrationJob({
        id: 'job-uuid-conflicts',
        status: 'completed_with_conflicts',
        total_documents: 8,
        processed_documents: 8,
      })]);
      stub.on(migrationConflicts).select.returnsRaw([{ value: 2 }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.activeMigration).toEqual({
        jobId: 'job-uuid-conflicts',
        status: 'completed_with_conflicts',
        processedDocuments: 8,
        totalDocuments: 8,
        unresolvedConflicts: 2,
      });
    });

    it('should report activeMigration as null when the latest job is cleanly completed', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 5 }]);
      stub.on(documents).select.returnsRaw([{ count: '0', oldest_version: null }]);
      stub.on(migrationJobs).select.returnsRaw([createMockMigrationJob({
        id: 'job-uuid-done',
        status: 'completed',
        total_documents: 6,
        processed_documents: 6,
      })]);
      stub.on(migrationConflicts).select.returnsRaw([{ value: 0 }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.activeMigration).toBeNull();
    });

    it('should report activeMigration as null when a completed_with_conflicts job has all conflicts resolved', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 5 }]);
      stub.on(documents).select.returnsRaw([{ count: '0', oldest_version: null }]);
      stub.on(migrationJobs).select.returnsRaw([createMockMigrationJob({
        id: 'job-uuid-resolved',
        status: 'completed_with_conflicts',
        total_documents: 4,
        processed_documents: 4,
      })]);
      stub.on(migrationConflicts).select.returnsRaw([{ value: 0 }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.activeMigration).toBeNull();
    });
  });

  // =========================================================================
  // previewMigration
  // =========================================================================

  describe('previewMigration', () => {
    it('should return summary preview with affected docs and conflicts', async () => {
      // previewMigration checks the template exists through the Drizzle handle.
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      const templateFrom = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const templateTo = { content: [{ type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const baseline = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const unchangedDoc = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const divergedDoc = { content: [{ type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };

      // The preview pages by a fixed step, so only the first page holds
      // documents; every page after it comes back empty.
      stub.on(documents).select.whenBound([0]).returnsRaw([
        { ...createMockDocument({ id: 'doc-1', path: '/blog/post-1', template_version: 2 }), snapshot: unchangedDoc },
        { ...createMockDocument({ id: 'doc-2', path: '/blog/post-2', template_version: 3 }), snapshot: divergedDoc },
        { ...createMockDocument({ id: 'doc-3', path: '/blog/post-3', template_version: 2 }), snapshot: unchangedDoc },
      ]);
      stub.on(documents).select.whenAsking(/LIMIT \$/).returnsRaw([]);

      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string, _branch: string, version: number) => {
        if (id === 'template-uuid-001') return Promise.resolve(version === 2 ? templateFrom : templateTo);
        return Promise.resolve(baseline);
      });

      const result = await previewMigration(
        'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 2, 5, false,
      );

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.fromVersion).toBe(2);
      expect(result.toVersion).toBe(5);
      expect(result.templateDelta.removed).toEqual(['Hero-a']);
      expect(result.affectedDocuments).toBe(3);
      expect(result.estimatedConflicts).toBe(1);
      expect(result.cleanDocuments).toBe(2);
      expect(result.documents).toBeUndefined();
    });

    it('should return detailed preview with per-document info when detail=true', async () => {
      // previewMigration checks the template exists through the Drizzle handle.
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      const templateFrom = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const templateTo = { content: [{ type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const baseline = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const cleanDoc = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };
      const conflictDoc = { content: [{ type: 'Body', props: { id: 'Body-b' } }], root: { props: {} }, zones: {} };

      // The preview pages by a fixed step, so only the first page holds
      // documents; every page after it comes back empty.
      stub.on(documents).select.whenBound([0]).returnsRaw([
        { ...createMockDocument({ id: 'doc-clean', path: '/blog/clean', template_version: 2 }), snapshot: cleanDoc },
        { ...createMockDocument({ id: 'doc-conflict', path: '/blog/conflict', template_version: 3 }), snapshot: conflictDoc },
      ]);
      stub.on(documents).select.whenAsking(/LIMIT \$/).returnsRaw([]);

      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string, _branch: string, version: number) => {
        if (id === 'template-uuid-001') return Promise.resolve(version === 2 ? templateFrom : templateTo);
        return Promise.resolve(baseline);
      });

      const result = await previewMigration(
        'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 2, 5, true,
      );

      expect(result.affectedDocuments).toBe(2);
      expect(result.estimatedConflicts).toBe(1);
      expect(result.cleanDocuments).toBe(1);

      expect(result.documents).toBeDefined();
      expect(result.documents).toHaveLength(2);

      const docs = result.documents ?? [];
      const cleanEntry = docs.find((d) => d.documentId === 'doc-clean');
      expect(cleanEntry).toBeDefined();
      expect(cleanEntry?.path).toBe('/blog/clean');
      expect(cleanEntry?.currentTemplateVersion).toBe(2);
      expect(cleanEntry?.applied).toBe(true);
      expect(cleanEntry?.hasConflict).toBe(false);
      expect(cleanEntry?.propConflicts).toEqual([]);
      expect(cleanEntry?.proposedSnapshot).toBeDefined();
      expect(cleanEntry?.structuralConflict).toBeUndefined();

      const conflictEntry = docs.find((d) => d.documentId === 'doc-conflict');
      expect(conflictEntry).toBeDefined();
      expect(conflictEntry?.path).toBe('/blog/conflict');
      expect(conflictEntry?.currentTemplateVersion).toBe(3);
      expect(conflictEntry?.applied).toBe(false);
      expect(conflictEntry?.hasConflict).toBe(true);
      expect(conflictEntry?.propConflicts).toEqual([]);
      expect(conflictEntry?.structuralConflict).toBeDefined();
      expect(conflictEntry?.structuralConflict?.templateDelta).toBeDefined();
      expect(conflictEntry?.structuralConflict?.documentDelta).toBeDefined();
      expect(conflictEntry?.proposedSnapshot).toBeUndefined();
    });

    it('should return empty preview when no documents are affected', async () => {
      // previewMigration checks the template exists through the Drizzle handle.
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      stub.on(documents).select.whenAsking(/LIMIT \$/).returnsRaw([]);
      vi.mocked(reconstructVersionSnapshot).mockResolvedValue({
        content: [{ type: 'Footer', props: { id: 'Footer-f' } }], root: { props: {} }, zones: {},
      });

      const result = await previewMigration(
        'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 1, 3, false,
      );

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(3);
      expect(result.affectedDocuments).toBe(0);
      expect(result.estimatedConflicts).toBe(0);
      expect(result.cleanDocuments).toBe(0);
      expect(result.documents).toBeUndefined();
    });

    it('should throw TemplateNotFoundError when template not found', async () => {

      // Template does not exist
      await expect(
        previewMigration(
          'site-uuid-456',
          'branch-uuid-789',
          'nonexistent-template',
          1,
          3,
          false,
        ),
      ).rejects.toThrow(TemplateNotFoundError);
    });

    it('should throw InvalidVersionRangeError for invalid version range', async () => {

      // fromVersion > toVersion
      await expect(
        previewMigration(
          'site-uuid-456',
          'branch-uuid-789',
          'template-uuid-001',
          5,
          3,
          false,
        ),
      ).rejects.toThrow(InvalidVersionRangeError);

      // fromVersion === toVersion
      await expect(
        previewMigration(
          'site-uuid-456',
          'branch-uuid-789',
          'template-uuid-001',
          3,
          3,
          false,
        ),
      ).rejects.toThrow(InvalidVersionRangeError);
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  describe('Error Handling', () => {
    it('should throw TemplateNotFoundError when template does not exist in triggerMigration', async () => {

      // Template lookup returns empty
      await expect(
        triggerMigration(
          'site-uuid-456',
          'branch-uuid-789',
          'nonexistent-template',
          1,
          2,
          { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow(TemplateNotFoundError);

      try {
        // Reset mocks for second call
        await triggerMigration(
          'site-uuid-456', 'branch-uuid-789', 'nonexistent-template',
          1, 2, { id: 'user-uuid-001', type: 'user' },
        );
      } catch (err) {
        expect(err).toBeInstanceOf(TemplateNotFoundError);
        expect((err as InstanceType<typeof TemplateNotFoundError>).templateId).toBe('nonexistent-template');
      }
    });

    it('should throw InvalidVersionRangeError for invalid version range (from >= to)', async () => {

      // from > to
      await expect(
        triggerMigration(
          'site-uuid-456', 'branch-uuid-789', 'template-uuid-001',
          5, 3, { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow(InvalidVersionRangeError);

      // from === to
      await expect(
        triggerMigration(
          'site-uuid-456', 'branch-uuid-789', 'template-uuid-001',
          3, 3, { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow(InvalidVersionRangeError);
    });

    it('should throw MigrationJobNotFoundError in getMigrationJob when job missing', async () => {

      await expect(getMigrationJob('nonexistent')).rejects.toThrow(MigrationJobNotFoundError);

      try {
        await getMigrationJob('bad-id');
      } catch (err) {
        expect(err).toBeInstanceOf(MigrationJobNotFoundError);
        expect((err as InstanceType<typeof MigrationJobNotFoundError>).jobId).toBe('bad-id');
      }
    });

  });

  // =========================================================================
  // getMigrationStatus
  // =========================================================================

  describe('getMigrationStatus', () => {
    it('should return status with stale documents', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(documents).select.returnsRaw([{ count: '5', oldest_version: 1 }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.currentVersion).toBe(3);
      expect(result.staleDocumentCount).toBe(5);
      expect(result.oldestDocumentVersion).toBe(1);
      expect(result.migrationAvailable).toBe(true);
    });

    it('should return migrationAvailable false when no stale documents', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 2 }]);
      stub.on(documents).select.returnsRaw([{ count: '0', oldest_version: null }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.staleDocumentCount).toBe(0);
      expect(result.oldestDocumentVersion).toBeNull();
      expect(result.migrationAvailable).toBe(false);
    });

    it('should throw TemplateNotFoundError when template has no versions', async () => {

      await expect(
        getMigrationStatus('missing-template', 'branch-uuid-789'),
      ).rejects.toThrow();
    });

    it('should query with NULL-aware stale document detection', async () => {

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 2 }]);
      stub.on(documents).select.returnsRaw([{ count: '3', oldest_version: 0 }]);

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.staleDocumentCount).toBe(3);
      expect(result.oldestDocumentVersion).toBe(0);

      // Verify the stale query uses IS NULL check
      const staleQuery = stub.calls(documents).select[0];
      expect(staleQuery.sql).toContain('IS NULL');
    });
  });

  // =========================================================================
  // previewMigration
  // =========================================================================

  describe('previewMigration', () => {
    it('should return summary preview without detail', async () => {
      // previewMigration checks the template exists through the Drizzle handle.
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      const docSnapshot = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }], root: { props: {} }, zones: {} };

      // The preview pages by a fixed step, so only the first page holds
      // documents; every page after it comes back empty.
      stub.on(documents).select.whenBound([0]).returnsRaw([{
        id: 'doc-uuid-001', site_id: 'site-uuid-456', path: 'pages/home',
        template_id: 'template-uuid-001', template_version: 1, snapshot: docSnapshot,
      }]);
      stub.on(documents).select.whenAsking(/LIMIT \$/).returnsRaw([]);

      // Template adds a CTA; the document is untouched since baseline, so it is clean.
      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string, _branch: string, version: number) => {
        if (id === 'template-uuid-001') {
          return Promise.resolve(version === 1
            ? { content: [{ type: 'Hero', props: { id: 'Hero-a' } }], root: { props: {} }, zones: {} }
            : { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'CTA', props: { id: 'CTA-c' } }], root: { props: {} }, zones: {} });
        }
        return Promise.resolve(docSnapshot);
      });

      const result = await previewMigration(
        'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 1, 2, false,
      );

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(2);
      expect(result.affectedDocuments).toBe(1);
      expect(result.estimatedConflicts).toBe(0);
      expect(result.cleanDocuments).toBe(1);
      expect(result.documents).toBeUndefined();
    });

    it('should include per-document detail when detail is true', async () => {
      // previewMigration checks the template exists through the Drizzle handle.
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      const docSnapshot = { content: [{ type: 'Hero', props: { id: 'Hero-a' } }], root: { props: {} }, zones: {} };

      // The preview pages by a fixed step, so only the first page holds
      // documents; every page after it comes back empty.
      stub.on(documents).select.whenBound([0]).returnsRaw([{
        id: 'doc-uuid-001', site_id: 'site-uuid-456', path: 'pages/about',
        template_id: 'template-uuid-001', template_version: 1, snapshot: docSnapshot,
      }]);
      stub.on(documents).select.whenAsking(/LIMIT \$/).returnsRaw([]);

      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string, _branch: string, version: number) => {
        if (id === 'template-uuid-001') {
          return Promise.resolve(version === 1
            ? { content: [{ type: 'Hero', props: { id: 'Hero-a' } }], root: { props: {} }, zones: {} }
            : { content: [{ type: 'Hero', props: { id: 'Hero-a' } }, { type: 'Footer', props: { id: 'Footer-f' } }], root: { props: {} }, zones: {} });
        }
        return Promise.resolve(docSnapshot);
      });

      const result = await previewMigration(
        'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 1, 2, true,
      );

      expect(result.documents).toBeDefined();
      expect(result.documents?.length).toBe(1);
      expect(result.documents?.[0].documentId).toBe('doc-uuid-001');
      expect(result.documents?.[0].path).toBe('pages/about');
      expect(result.documents?.[0].hasConflict).toBe(false);
      expect(result.documents?.[0].proposedSnapshot).toBeDefined();
      // The proposed snapshot should have the Footer inserted after the anchor.
      const content = result.documents?.[0].proposedSnapshot?.content as { type: string }[];
      expect(content).toHaveLength(2);
      expect(content[1].type).toBe('Footer');
    });

    it('should throw when fromVersion >= toVersion', async () => {

      await expect(
        previewMigration(
          'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 3, 2, false,
        ),
      ).rejects.toThrow();
    });

    it('should throw TemplateNotFoundError when template does not exist', async () => {

      await expect(
        previewMigration(
          'site-uuid-456', 'branch-uuid-789', 'missing-template', 1, 2, false,
        ),
      ).rejects.toThrow();
    });

    it('should return zero affected when no stale documents exist', async () => {
      // previewMigration checks the template exists through the Drizzle handle.
      stub.on(documents).select.returnsRaw([{ id: 'template-uuid-001' }]);

      stub.on(documents).select.whenAsking(/LIMIT \$/).returnsRaw([]);
      vi.mocked(reconstructVersionSnapshot).mockResolvedValue({ content: [], root: { props: {} }, zones: {} });

      const result = await previewMigration(
        'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 1, 2, false,
      );

      expect(result.affectedDocuments).toBe(0);
      expect(result.estimatedConflicts).toBe(0);
      expect(result.cleanDocuments).toBe(0);
    });
  });

  // =========================================================================
  // Nested prop operations
  // =========================================================================

  describe('applyDeltaToSnapshot: nested prop operations', () => {
    it('removes a nested prop key when the template migration drops it', async () => {

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'Hero-a', style: { color: 'red', size: 'lg' } } },
        ],
        root: { props: {} },
        zones: {},
      };

      const result = applyDeltaToSnapshot(
        docSnapshot,
        buildSlotDelta({ content: [] }, { content: [] }),
        {
          propPatches: [
            { componentId: 'Hero-a', operations: [{ op: 'remove', path: '/style/color' }] },
          ],
          fromTemplateContent: [
            { type: 'Hero', props: { id: 'Hero-a', style: { color: 'red', size: 'lg' } } },
          ],
        },
      );

      const hero = (result.content as { props: { style: Record<string, unknown> } }[])[0];
      expect(hero.props.style).toEqual({ size: 'lg' });
    });
  });

  // =========================================================================
  // Null snapshot handling
  // =========================================================================

  describe('null snapshot handling', () => {
    it('applyDeltaToSnapshot should return empty object for null snapshot', async () => {

      const result = applyDeltaToSnapshot(
        null,
        buildSlotDelta({ content: [] }, { content: [] }),
      );

      expect(result).toEqual({});
    });

    it('applyDeltaToSnapshot should return empty object for undefined snapshot', async () => {

      const result = applyDeltaToSnapshot(
        undefined,
        buildSlotDelta({ content: [] }, { content: [] }),
      );

      expect(result).toEqual({});
    });

    it('applyDeltaToDocument should fall back to reconstructVersionSnapshot when latest has null snapshot', async () => {

      const reconstructedSnapshot = {
        content: [
          { type: 'Hero', props: { title: 'Hi' } },
          { type: 'Body', props: { text: 'Hello' } },
        ],
        root: {},
        zones: {},
      };

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-200',
        documentId: 'doc-null-snap',
        branchId: 'branch-uuid-789',
        versionNumber: 3,
        snapshot: null as unknown as Record<string, unknown>,
        source: 'edit' as DocumentVersionSource,
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
      });

      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce(reconstructedSnapshot);

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-201',
        documentId: 'doc-null-snap',
        branchId: 'branch-uuid-789',
        versionNumber: 4,
        snapshot: reconstructedSnapshot,
        source: 'migration',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-18T10:01:00.000Z',
      });

      const delta = buildSlotDelta({ content: [] }, { content: [] });

      const result = await applyDeltaToDocument(
        'doc-null-snap',
        'branch-uuid-789',
        delta,
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(reconstructVersionSnapshot).toHaveBeenCalledWith('doc-null-snap', 'branch-uuid-789', 3);
      expect(result.versionId).toBe('version-uuid-201');
      expect(result.snapshot).toBeDefined();
      expect(createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'migration' }),
      );
    });

    it('applyDeltaToDocument should throw when no snapshot can be reconstructed', async () => {

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-300',
        documentId: 'doc-no-snap',
        branchId: 'branch-uuid-789',
        versionNumber: 2,
        snapshot: null as unknown as Record<string, unknown>,
        source: 'edit' as DocumentVersionSource,
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
      });

      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce(null);

      await expect(
        applyDeltaToDocument(
          'doc-no-snap',
          'branch-uuid-789',
          buildSlotDelta({ content: [] }, { content: [] }),
          { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow('No snapshot found for document doc-no-snap');
    });
  });

  // =========================================================================
  // Prop Patch Extraction and Application
  // =========================================================================

  describe('extractTemplateDelta: prop patch extraction', () => {
    it('should return propPatches when template props change (no structural)', async () => {

      // Reconstruct snapshots: prop values changed on existing component
      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce({
          content: [
            { type: 'Hero', props: { id: 'h1', title: 'Old Title', subtitle: 'Sub' } },
          ],
          root: { props: {} },
          zones: {},
        })
        .mockResolvedValueOnce({
          content: [
            { type: 'Hero', props: { id: 'h1', title: 'New Title', subtitle: 'Sub' } },
          ],
          root: { props: {} },
          zones: {},
        });

      const result = await extractTemplateDelta('tmpl-1', 'branch-1', 1, 2);

      expect(result.slotDelta.added).toEqual([]);
      expect(result.slotDelta.removed).toEqual([]);
      expect(result.slotDelta.moved).toEqual([]);
      expect(result.propPatches).toHaveLength(1);
      expect(result.propPatches[0].componentId).toBe('h1');
      expect(result.propPatches[0].operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: 'replace', path: '/title', value: 'New Title' }),
        ]),
      );
    });

    it('should return both structural and prop changes together', async () => {

      // Snapshots: Hero props changed AND Footer added
      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce({
          content: [
            { type: 'Hero', props: { id: 'h1', title: 'Old' } },
          ],
          root: { props: {} },
          zones: {},
        })
        .mockResolvedValueOnce({
          content: [
            { type: 'Hero', props: { id: 'h1', title: 'Updated' } },
            { type: 'Footer', props: { id: 'f1', links: ['/about'] } },
          ],
          root: { props: {} },
          zones: {},
        });

      const result = await extractTemplateDelta('tmpl-1', 'branch-1', 1, 2);

      expect(result.slotDelta.added).toHaveLength(1);
      expect(result.slotDelta.added[0].component.props.id).toBe('f1');
      expect(result.propPatches).toHaveLength(1);
      expect(result.propPatches[0].componentId).toBe('h1');
    });

    it('should capture root prop changes', async () => {

      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce({
          content: [],
          root: { props: { title: 'Old Site', description: 'Old desc' } },
          zones: {},
        })
        .mockResolvedValueOnce({
          content: [],
          root: { props: { title: 'New Site', description: 'Old desc' } },
          zones: {},
        });

      const result = await extractTemplateDelta('tmpl-1', 'branch-1', 1, 2);

      expect(result.slotDelta.added).toEqual([]);
      expect(result.slotDelta.removed).toEqual([]);
      expect(result.slotDelta.moved).toEqual([]);
      expect(result.propPatches).toHaveLength(1);
      expect(result.propPatches[0].componentId).toBe('__root__');
      expect(result.propPatches[0].operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: 'replace', path: '/title', value: 'New Site' }),
        ]),
      );
    });

    it('should capture zone component prop changes', async () => {

      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce({
          content: [],
          root: { props: {} },
          zones: {
            sidebar: [{ type: 'Widget', props: { id: 'w1', color: 'red' } }],
          },
        })
        .mockResolvedValueOnce({
          content: [],
          root: { props: {} },
          zones: {
            sidebar: [{ type: 'Widget', props: { id: 'w1', color: 'blue' } }],
          },
        });

      const result = await extractTemplateDelta('tmpl-1', 'branch-1', 1, 2);

      expect(result.propPatches).toHaveLength(1);
      expect(result.propPatches[0].componentId).toBe('w1');
      expect(result.propPatches[0].operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: 'replace', path: '/color', value: 'blue' }),
        ]),
      );
    });
  });

  describe('applyDeltaToSnapshot: prop patches', () => {
    it('should apply prop patches when document matches template default', async () => {

      const snapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Default Title' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, buildSlotDelta(snapshot, snapshot), {
        propPatches: [
          {
            componentId: 'h1',
            operations: [{ op: 'replace' as const, path: '/title', value: 'Updated Title' }],
          },
        ],
        fromTemplateContent: [
          { type: 'Hero', props: { id: 'h1', title: 'Default Title' } },
        ],
      });

      const hero = (result.content as { props: { title: string } }[])[0];
      expect(hero.props.title).toBe('Updated Title');
    });

    it('should skip prop patches when document has customized value', async () => {

      const snapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'My Custom Title' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, buildSlotDelta(snapshot, snapshot), {
        propPatches: [
          {
            componentId: 'h1',
            operations: [{ op: 'replace' as const, path: '/title', value: 'Updated Title' }],
          },
        ],
        fromTemplateContent: [
          { type: 'Hero', props: { id: 'h1', title: 'Default Title' } },
        ],
      });

      const hero = (result.content as { props: { title: string } }[])[0];
      expect(hero.props.title).toBe('My Custom Title');
    });

    it('should handle mixed customized and default props on same component', async () => {

      const snapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Custom', subtitle: 'Default Sub' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, buildSlotDelta(snapshot, snapshot), {
        propPatches: [
          {
            componentId: 'h1',
            operations: [
              { op: 'replace' as const, path: '/title', value: 'New Title' },
              { op: 'replace' as const, path: '/subtitle', value: 'New Sub' },
            ],
          },
        ],
        fromTemplateContent: [
          { type: 'Hero', props: { id: 'h1', title: 'Default Title', subtitle: 'Default Sub' } },
        ],
      });

      const hero = (result.content as { props: { title: string; subtitle: string } }[])[0];
      expect(hero.props.title).toBe('Custom');
      expect(hero.props.subtitle).toBe('New Sub');
    });

    it('should skip prop patches when component was removed from document', async () => {

      const snapshot = {
        content: [
          { type: 'Body', props: { id: 'b1', text: 'Hello' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, buildSlotDelta(snapshot, snapshot), {
        propPatches: [
          {
            componentId: 'h1',
            operations: [{ op: 'replace' as const, path: '/title', value: 'Updated' }],
          },
        ],
        fromTemplateContent: [
          { type: 'Hero', props: { id: 'h1', title: 'Default' } },
        ],
      });

      expect(result.content).toHaveLength(1);
      const body = (result.content as { props: { id: string } }[])[0];
      expect(body.props.id).toBe('b1');
    });

    it('should apply nested prop changes (e.g., links array)', async () => {

      const snapshot = {
        content: [
          { type: 'Footer', props: { id: 'f1', links: [{ text: 'Home', url: '/' }] } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, buildSlotDelta(snapshot, snapshot), {
        propPatches: [
          {
            componentId: 'f1',
            operations: [
              { op: 'replace' as const, path: '/links', value: [{ text: 'Home', url: '/' }, { text: 'About', url: '/about' }] },
            ],
          },
        ],
        fromTemplateContent: [
          { type: 'Footer', props: { id: 'f1', links: [{ text: 'Home', url: '/' }] } },
        ],
      });

      const footer = (result.content as { props: { links: unknown[] } }[])[0];
      expect(footer.props.links).toHaveLength(2);
    });

    it('should apply root prop patches', async () => {

      const snapshot = {
        content: [],
        root: { props: { title: 'Old Page Title' } },
      };

      const result = applyDeltaToSnapshot(snapshot, buildSlotDelta(snapshot, snapshot), {
        propPatches: [
          {
            componentId: '__root__',
            operations: [{ op: 'replace' as const, path: '/title', value: 'New Page Title' }],
          },
        ],
        fromTemplateContent: [],
        fromRootProps: { title: 'Old Page Title' },
      });

      const root = result.root as { props: { title: string } };
      expect(root.props.title).toBe('New Page Title');
    });

    it('should apply zone component prop patches', async () => {

      const snapshot = {
        content: [],
        zones: {
          sidebar: [{ type: 'Widget', props: { id: 'w1', color: 'red' } }],
        },
      };

      const result = applyDeltaToSnapshot(snapshot, buildSlotDelta(snapshot, snapshot), {
        propPatches: [
          {
            componentId: 'w1',
            operations: [{ op: 'replace' as const, path: '/color', value: 'blue' }],
          },
        ],
        fromTemplateContent: [],
        fromZones: {
          sidebar: [{ type: 'Widget', props: { id: 'w1', color: 'red' } }],
        },
      });

      const zones = result.zones as { sidebar: { props: { color: string } }[] };
      expect(zones.sidebar[0].props.color).toBe('blue');
    });
  });

  describe('detectDocumentConflicts: prop conflicts', () => {
    it('should flag prop conflicts when document has customized a prop the template also changed', async () => {

      const documentSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Custom User Title' } },
        ],
      };

      // Baseline equals the current document, so the document has no structural change.
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      vi.mocked(reconstructVersionSnapshot).mockResolvedValue(documentSnapshot);

      const result = await detectDocumentConflicts(
        'doc-1', 'branch-1', buildSlotDelta({ content: [] }, { content: [] }), documentSnapshot,
        {
          propPatches: [
            {
              componentId: 'h1',
              operations: [{ op: 'replace' as const, path: '/title', value: 'New Template Title' }],
            },
          ],
          fromTemplateContent: [
            { type: 'Hero', props: { id: 'h1', title: 'Old Template Title' } },
          ],
        },
      );

      expect(result).not.toBeNull();
      expect(result?.hasConflict).toBe(false);
      expect(result?.propConflicts).toHaveLength(1);
      expect(result?.propConflicts?.[0]).toEqual(expect.objectContaining({
        componentId: 'h1',
        propPath: '/title',
      }));
    });

    it('should return no prop conflict when document uses template defaults', async () => {

      const documentSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Old Title' } },
        ],
      };

      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      vi.mocked(reconstructVersionSnapshot).mockResolvedValue(documentSnapshot);

      const result = await detectDocumentConflicts(
        'doc-1', 'branch-1', buildSlotDelta({ content: [] }, { content: [] }), documentSnapshot,
        {
          propPatches: [
            {
              componentId: 'h1',
              operations: [{ op: 'replace' as const, path: '/title', value: 'New Title' }],
            },
          ],
          fromTemplateContent: [
            { type: 'Hero', props: { id: 'h1', title: 'Old Title' } },
          ],
        },
      );

      // No structural change and the document still matches the template default -> null.
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // processMigration: prop conflict detection
  // =========================================================================

  describe('processMigration: prop conflict detection', () => {
    it('migrates the clean changes and records a conflict when a prop diverged', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 1 });
      const docSnapshot = {
        content: [{ type: 'Hero', props: { id: 'hero-1', title: 'My Custom Title' } }],
        root: { props: {} },
        zones: {},
      };

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);
      stub.on(documents).select.returnsRaw([{ ...createMockDocument({ id: 'doc-custom', template_version: 1 }), snapshot: docSnapshot }]);
      // A migrated document stops matching the listing, which is what ends
      // the paging loop; the notification is where that becomes true.
      const migrated = (): Promise<void> => {
        stub.on(documents).select.returnsRaw([]);
        return Promise.resolve();
      };

      // Template changes only Hero's title; the document customized that title.
      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string, _branch: string, version: number) => {
        if (id === 'template-uuid-001') {
          return Promise.resolve(version === 1
            ? { content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Old Title' } }], root: { props: {} }, zones: {} }
            : { content: [{ type: 'Hero', props: { id: 'hero-1', title: 'New Title' } }], root: { props: {} }, zones: {} });
        }
        return Promise.resolve(docSnapshot);
      });

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-300', documentId: 'doc-custom', branchId: 'branch-uuid-789', versionNumber: 3,
        snapshot: docSnapshot, source: 'edit' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user', createdAt: '2026-06-18T10:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-301', documentId: 'doc-custom', branchId: 'branch-uuid-789', versionNumber: 4,
        snapshot: docSnapshot, source: 'migration',
        createdById: 'user-uuid-001', createdByType: 'user', createdAt: '2026-06-18T10:01:00.000Z',
      });

      const result = await processMigration('job-uuid-123', migrated);

      // A diverged prop is kept by the clean merge and recorded as a conflict:
      // the document is both migrated and flagged for a decision.
      expect(result.conflictedDocuments).toBe(1);
      expect(result.processedDocuments).toBe(1);
      const persisted = vi.mocked(createDocumentVersion).mock.calls[0][0];
      const content = (persisted.snapshot as { content: { props: { title: string } }[] }).content;
      expect(content[0].props.title).toBe('My Custom Title');

      const [insertCall] = stub.calls(migrationConflicts).insert;
      expect(insertCall).toBeDefined();
      expect(insertCall.sql).toContain("'prop'");
    });

    it('does not advance synced_version when recording the prop divergence fails', async () => {

      const mockJob = createMockMigrationJob({ total_documents: 1 });
      const docSnapshot = {
        content: [{ type: 'Hero', props: { id: 'hero-1', title: 'My Custom Title' } }],
        root: { props: {} },
        zones: {},
      };

      stub.on(migrationJobs).select.returnsRaw([mockJob]);
      stub.on(documentVersions).select.returnsRaw([{ versionNumber: 3 }]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-uuid-123' }]);
      // A conflicted document stays in the listing, so the run advances its
      // offset past this page and the next read comes back empty.
      stub.on(documents).select.whenBound([0]).returnsRaw([{ ...createMockDocument({ id: 'doc-custom', template_version: 1 }), snapshot: docSnapshot }]);
      // The prop-divergence record is the insert that fails; the structural
      // record the recovery path writes must still go through.
      stub.on(migrationConflicts).insert
        .whenAsking(/prop_conflicts/)
        .rejects(new Error('insert failed'));

      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string, _branch: string, version: number) => {
        if (id === 'template-uuid-001') {
          return Promise.resolve(version === 1
            ? { content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Old Title' } }], root: { props: {} }, zones: {} }
            : { content: [{ type: 'Hero', props: { id: 'hero-1', title: 'New Title' } }], root: { props: {} }, zones: {} });
        }
        return Promise.resolve(docSnapshot);
      });

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-300', documentId: 'doc-custom', branchId: 'branch-uuid-789', versionNumber: 3,
        snapshot: docSnapshot, source: 'edit' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user', createdAt: '2026-06-18T10:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-301', documentId: 'doc-custom', branchId: 'branch-uuid-789', versionNumber: 4,
        snapshot: docSnapshot, source: 'migration',
        createdById: 'user-uuid-001', createdByType: 'user', createdAt: '2026-06-18T10:01:00.000Z',
      });

      await processMigration('job-uuid-123');

      // The document is not counted clean, so its template edge keeps the old
      // synced_version and the document is re-picked on the next run.
      const cleanUpdate = stub.calls(documentRelations).update.find(
        (call) => call.sql.includes('SET synced_version'),
      );
      expect(cleanUpdate).toBeUndefined();
    });
  });
});
