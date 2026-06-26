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

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

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
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Mock types for database rows
  interface MockMigrationJobRow {
    id: string;
    site_id: string;
    branch_id: string;
    template_id: string;
    from_version: number;
    to_version: number;
    checkpoint_id: string | null;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    total_documents: number;
    processed_documents: number;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
    completed_at: string | null;
  }

  interface MockMigrationConflictRow {
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
  }

  interface MockDocumentRow {
    id: string;
    site_id: string;
    branch_id: string;
    path: string;
    template_id: string | null;
    template_version: number | null;
  }

  interface MockDocumentVersionRow {
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown>;
    source: DocumentVersionSource;
    action_type: string | null;
    action_metadata: Record<string, unknown> | null;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
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

  // Helper to create mock document version
  function createMockDocumentVersion(overrides: Partial<MockDocumentVersionRow> = {}): MockDocumentVersionRow {
    return {
      id: 'version-uuid-123',
      document_id: 'doc-uuid-123',
      branch_id: 'branch-uuid-789',
      version_number: 1,
      snapshot: { content: [], root: {}, zones: {} },
      source: 'edit',
      action_type: null,
      action_metadata: null,
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-06-08T09:00:00.000Z',
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
      template_delta: [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1 }],
      document_actions: [{ type: 'insert', componentType: 'Hero', zone: 'content' }],
      resolution: null,
      created_at: '2026-06-08T11:00:00.000Z',
      resolved_at: null,
      ...overrides,
    };
  }

  // =========================================================================
  // extractTemplateDelta
  // =========================================================================

  describe('extractTemplateDelta', () => {
    it('should extract structural actions from template version history', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      const mockVersionRows = [
        createMockDocumentVersion({
          id: 'tv-1',
          document_id: 'template-uuid-001',
          version_number: 2,
          action_type: 'structural',
          action_metadata: {
            puckActions: [
              { type: 'reorder', sourceIndex: 0, destinationIndex: 2 },
            ],
          },
        }),
      ];

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: mockVersionRows,
        rowCount: 1,
      });

      // Mock snapshot reconstruction for prop patch extraction
      const sameSnapshot = { content: [{ type: 'Hero', props: { id: 'h1' } }], root: { props: {} }, zones: {} };
      vi.mocked(dvs.reconstructVersionSnapshot)
        .mockResolvedValueOnce(sameSnapshot)
        .mockResolvedValueOnce(sameSnapshot);

      const result = await extractTemplateDelta(
        'template-uuid-001',
        'branch-uuid-789',
        1,
        2,
      );

      expect(result.structuralActions).toEqual([
        { type: 'reorder', sourceIndex: 0, destinationIndex: 2 },
      ]);
      expect(result.propPatches).toEqual([]);

      // Verify the query filters by template_id, branch_id, version range, and action_type
      const callArgs = vi.mocked(db.query).mock.calls[0];
      const sql = callArgs[0] as string;
      expect(sql).toContain('action_type');
      expect(sql).toContain('structural');
      expect(callArgs[1]).toEqual(
        expect.arrayContaining(['template-uuid-001', 'branch-uuid-789']),
      );
    });

    it('should flatten puckActions from multiple versions', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      const mockVersionRows = [
        createMockDocumentVersion({
          id: 'tv-1',
          version_number: 2,
          action_type: 'structural',
          action_metadata: {
            puckActions: [
              { type: 'reorder', sourceIndex: 0, destinationIndex: 1 },
            ],
          },
        }),
        createMockDocumentVersion({
          id: 'tv-2',
          version_number: 3,
          action_type: 'structural',
          action_metadata: {
            puckActions: [
              { type: 'insert', componentType: 'Footer', zone: 'content' },
              { type: 'delete', sourceIndex: 2 },
            ],
          },
        }),
      ];

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: mockVersionRows,
        rowCount: 2,
      });

      const sameSnapshot = { content: [], root: { props: {} }, zones: {} };
      vi.mocked(dvs.reconstructVersionSnapshot)
        .mockResolvedValueOnce(sameSnapshot)
        .mockResolvedValueOnce(sameSnapshot);

      const result = await extractTemplateDelta(
        'template-uuid-001',
        'branch-uuid-789',
        1,
        3,
      );

      // All puckActions from all versions should be flattened in order
      expect(result.structuralActions).toHaveLength(3);
      expect(result.structuralActions[0]).toEqual({ type: 'reorder', sourceIndex: 0, destinationIndex: 1 });
      expect(result.structuralActions[1]).toEqual({ type: 'insert', componentType: 'Footer', zone: 'content' });
      expect(result.structuralActions[2]).toEqual({ type: 'delete', sourceIndex: 2 });
    });

    it('should return empty delta when no changes exist', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const sameSnapshot = { content: [], root: { props: {} }, zones: {} };
      vi.mocked(dvs.reconstructVersionSnapshot)
        .mockResolvedValueOnce(sameSnapshot)
        .mockResolvedValueOnce(sameSnapshot);

      const result = await extractTemplateDelta(
        'template-uuid-001',
        'branch-uuid-789',
        1,
        2,
      );

      expect(result).toEqual({ structuralActions: [], propPatches: [] });
    });
  });

  // =========================================================================
  // getMigrationJob
  // =========================================================================

  describe('getMigrationJob', () => {
    it('should return a migration job by ID', async () => {
      const { getMigrationJob } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockRow = createMockMigrationJob();

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

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
      const { getMigrationJob, MigrationJobNotFoundError } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await expect(getMigrationJob('nonexistent-job')).rejects.toThrow(MigrationJobNotFoundError);
    });

    it('should query the migration_jobs table with the correct job ID', async () => {
      const { getMigrationJob } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockRow = createMockMigrationJob();
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      });

      await getMigrationJob('job-uuid-123');

      expect(db.query).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(db.query).mock.calls[0];
      expect(callArgs[1]).toEqual(['job-uuid-123']);
    });
  });

  // =========================================================================
  // listMigrationConflicts
  // =========================================================================

  describe('listMigrationConflicts', () => {
    it('should return all conflicts for a migration job', async () => {
      const { listMigrationConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockConflicts = [
        createMockConflictRow({ id: 'conflict-1', document_id: 'doc-1' }),
        createMockConflictRow({ id: 'conflict-2', document_id: 'doc-2' }),
      ];

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: mockConflicts,
        rowCount: 2,
      });

      const result = await listMigrationConflicts('job-uuid-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('conflict-1');
      expect(result[0].documentId).toBe('doc-1');
      expect(result[1].id).toBe('conflict-2');
      expect(result[1].documentId).toBe('doc-2');
    });

    it('should return empty array when no conflicts exist', async () => {
      const { listMigrationConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await listMigrationConflicts('job-uuid-123');

      expect(result).toEqual([]);
    });

    it('should query migration_conflicts by migration_job_id', async () => {
      const { listMigrationConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await listMigrationConflicts('job-uuid-123');

      expect(db.query).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(db.query).mock.calls[0];
      expect(callArgs[1]).toEqual(['job-uuid-123']);
    });
  });

  // =========================================================================
  // findAffectedDocuments
  // =========================================================================

  describe('findAffectedDocuments', () => {
    it('should return paginated documents with snapshots', async () => {
      const { findAffectedDocuments } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

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

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: mockDocRows,
        rowCount: 2,
      });

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
      const { findAffectedDocuments } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await findAffectedDocuments(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        3,
        50,
        0,
      );

      expect(db.query).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(db.query).mock.calls[0];
      const sql = callArgs[0] as string;
      // Should filter by template_id and template_version < toVersion
      expect(sql).toContain('template_id');
      expect(sql).toContain('template_version');
      // Parameters should include branchId, templateId, toVersion, limit, offset
      expect(callArgs[1]).toEqual(
        expect.arrayContaining(['branch-uuid-789', 'template-uuid-001']),
      );
    });

    it('should apply LIMIT and OFFSET for pagination', async () => {
      const { findAffectedDocuments } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await findAffectedDocuments(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        2,
        50,
        100,
      );

      expect(db.query).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(db.query).mock.calls[0];
      const sql = callArgs[0] as string;
      expect(sql.toUpperCase()).toContain('LIMIT');
      expect(sql.toUpperCase()).toContain('OFFSET');
      // limit and offset should be in the parameters
      const params = callArgs[1] as unknown[];
      expect(params).toContain(50);
      expect(params).toContain(100);
    });

    it('should return empty array when no documents are affected', async () => {
      const { findAffectedDocuments } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

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
      const { findAffectedDocuments } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockDocRows = [
        {
          ...createMockDocument({ id: 'doc-1', template_version: 1 }),
          snapshot: { content: [{ type: 'Hero' }, { type: 'Footer' }], root: { props: {} }, zones: {} },
        },
      ];

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: mockDocRows,
        rowCount: 1,
      });

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
  // detectDocumentConflicts
  // =========================================================================

  describe('detectDocumentConflicts', () => {
    it('should detect conflicts when document has overlapping structural actions', async () => {
      const { detectDocumentConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const templateDelta = [
        { type: 'reorder' as const, sourceIndex: 0, destinationIndex: 1, componentType: 'Hero' },
      ];

      // Document has structural actions that overlap with template delta
      const docVersionRows = [
        createMockDocumentVersion({
          action_type: 'structural',
          action_metadata: {
            puckActions: [
              { type: 'reorder', sourceIndex: 1, destinationIndex: 0, componentType: 'Hero' },
            ],
          },
        }),
      ];

      // Mock: last migration version lookup
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 0 }],
        rowCount: 1,
      });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: docVersionRows,
        rowCount: 1,
      });

      const result = await detectDocumentConflicts(
        'doc-uuid-123',
        'branch-uuid-789',
        templateDelta,
        1,
        2,
      );

      expect(result).not.toBeNull();
      expect(result!.hasConflict).toBe(true);
      expect(result!.templateDelta).toEqual(templateDelta);
      expect(result!.documentActions).toHaveLength(1);
    });

    it('should return null when no document structural changes exist', async () => {
      const { detectDocumentConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const templateDelta = [
        { type: 'reorder' as const, sourceIndex: 0, destinationIndex: 1 },
      ];

      // Mock: last migration version lookup
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 0 }],
        rowCount: 1,
      });
      // No structural versions found for the document
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await detectDocumentConflicts(
        'doc-uuid-123',
        'branch-uuid-789',
        templateDelta,
        1,
        2,
      );

      // Prop-only changes = no conflict = null
      expect(result).toBeNull();
    });

    it('should extract puckActions from action_metadata of document versions', async () => {
      const { detectDocumentConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const templateDelta = [
        { type: 'insert' as const, componentType: 'Banner', zone: 'content' },
      ];

      const docVersionRows = [
        createMockDocumentVersion({
          action_type: 'structural',
          action_metadata: {
            puckActions: [
              { type: 'insert', componentType: 'Banner', zone: 'content' },
            ],
          },
        }),
      ];

      // Mock: last migration version lookup
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 0 }],
        rowCount: 1,
      });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: docVersionRows,
        rowCount: 1,
      });

      const result = await detectDocumentConflicts(
        'doc-uuid-123',
        'branch-uuid-789',
        templateDelta,
        1,
        2,
      );

      expect(result).not.toBeNull();
      expect(result!.documentActions[0]).toEqual(
        expect.objectContaining({ type: 'insert', componentType: 'Banner' }),
      );
    });

    it('should query document versions since fromVersion with structural action_type', async () => {
      const { detectDocumentConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const templateDelta = [
        { type: 'delete' as const, sourceIndex: 0 },
      ];

      // Mock: last migration version lookup
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 0 }],
        rowCount: 1,
      });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await detectDocumentConflicts(
        'doc-uuid-123',
        'branch-uuid-789',
        templateDelta,
        3,
        5,
      );

      expect(db.query).toHaveBeenCalledTimes(2);
      // Second call is the structural version query
      const callArgs = vi.mocked(db.query).mock.calls[1];
      const sql = callArgs[0] as string;
      expect(sql).toContain('action_type');
      expect(sql).toContain('structural');
      // Should include document_id, branch_id in params
      expect(callArgs[1]).toEqual(
        expect.arrayContaining(['doc-uuid-123', 'branch-uuid-789']),
      );
    });
  });

  // =========================================================================
  // applyDeltaToSnapshot (pure function — no mocks needed)
  // =========================================================================

  describe('applyDeltaToSnapshot', () => {
    it('should return snapshot unchanged when delta is empty', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'Hero', props: { title: 'Hi' } },
          { type: 'Body', props: { text: 'Hello' } },
        ],
        root: { someKey: 'value' },
      };

      const result = applyDeltaToSnapshot(snapshot, []);

      expect(result.content).toEqual(snapshot.content);
      expect(result.root).toEqual({ someKey: 'value' });
    });

    it('should insert component at specified destinationIndex', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'Hero', props: { title: 'Hi' } },
          { type: 'Body', props: { text: 'Hello' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'insert', componentType: 'CTA', destinationIndex: 1 },
      ]);

      expect(result.content).toHaveLength(3);
      expect((result.content as { type: string }[])[0].type).toBe('Hero');
      expect((result.content as { type: string }[])[1].type).toBe('CTA');
      expect((result.content as { type: string }[])[2].type).toBe('Body');
    });

    it('should append component when destinationIndex is null', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [{ type: 'Hero', props: { title: 'Hi' } }],
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'insert', componentType: 'Footer' },
      ]);

      expect(result.content).toHaveLength(2);
      expect((result.content as { type: string }[])[1].type).toBe('Footer');
    });

    it('should delete component at sourceIndex', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'Hero', props: {} },
          { type: 'Body', props: {} },
          { type: 'Footer', props: {} },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'delete', sourceIndex: 1 },
      ]);

      expect(result.content).toHaveLength(2);
      expect((result.content as { type: string }[])[0].type).toBe('Hero');
      expect((result.content as { type: string }[])[1].type).toBe('Footer');
    });

    it('should reorder component from sourceIndex to destinationIndex', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'A', props: {} },
          { type: 'B', props: {} },
          { type: 'C', props: {} },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'reorder', sourceIndex: 0, destinationIndex: 2 },
      ]);

      expect((result.content as { type: string }[])[0].type).toBe('B');
      expect((result.content as { type: string }[])[1].type).toBe('C');
      expect((result.content as { type: string }[])[2].type).toBe('A');
    });

    it('should move component from sourceIndex to destinationIndex', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'X', props: {} },
          { type: 'Y', props: {} },
          { type: 'Z', props: {} },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'move', sourceIndex: 2, destinationIndex: 0 },
      ]);

      expect((result.content as { type: string }[])[0].type).toBe('Z');
      expect((result.content as { type: string }[])[1].type).toBe('X');
      expect((result.content as { type: string }[])[2].type).toBe('Y');
    });

    it('should apply multiple actions sequentially', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'Hero', props: {} },
          { type: 'Body', props: {} },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'insert', componentType: 'CTA', destinationIndex: 2 },
        { type: 'delete', sourceIndex: 0 },
      ]);

      // After insert at 2: [Hero, Body, CTA]
      // After delete at 0: [Body, CTA]
      expect(result.content).toHaveLength(2);
      expect((result.content as { type: string }[])[0].type).toBe('Body');
      expect((result.content as { type: string }[])[1].type).toBe('CTA');
    });

    it('should handle snapshot with no content array', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = { root: {}, zones: {} };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'insert', componentType: 'Hero', destinationIndex: 0 },
      ]);

      expect(result.content).toHaveLength(1);
      expect((result.content as { type: string }[])[0].type).toBe('Hero');
    });

    it('should not mutate the original snapshot', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const original = {
        content: [
          { type: 'Hero', props: {} },
          { type: 'Body', props: {} },
        ],
        root: { key: 'val' },
      };

      applyDeltaToSnapshot(original, [
        { type: 'delete', sourceIndex: 0 },
      ]);

      expect(original.content).toHaveLength(2);
    });

    it('should use "Unknown" as componentType when not specified on insert', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = { content: [] };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'insert', destinationIndex: 0 },
      ]);

      expect((result.content as { type: string }[])[0].type).toBe('Unknown');
    });

    it('should handle delete at last index', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'A', props: {} },
          { type: 'B', props: {} },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'delete', sourceIndex: 1 },
      ]);

      expect(result.content).toHaveLength(1);
      expect((result.content as { type: string }[])[0].type).toBe('A');
    });

    it('should ignore delete action when sourceIndex is missing', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [{ type: 'Hero', props: {} }],
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'delete' },
      ]);

      expect(result.content).toHaveLength(1);
    });

    it('should ignore reorder when sourceIndex or destinationIndex missing', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'A', props: {} },
          { type: 'B', props: {} },
        ],
      };

      const result1 = applyDeltaToSnapshot(snapshot, [
        { type: 'reorder', sourceIndex: 0 },
      ]);
      expect((result1.content as { type: string }[])[0].type).toBe('A');

      const result2 = applyDeltaToSnapshot(snapshot, [
        { type: 'reorder', destinationIndex: 1 },
      ]);
      expect((result2.content as { type: string }[])[0].type).toBe('A');
    });

    it('should preserve non-content properties in the snapshot', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [{ type: 'Hero', props: {} }],
        root: { title: 'Page Title' },
        zones: { sidebar: [] },
      };

      const result = applyDeltaToSnapshot(snapshot, [
        { type: 'insert', componentType: 'Footer' },
      ]);

      expect(result.root).toEqual({ title: 'Page Title' });
      expect(result.zones).toEqual({ sidebar: [] });
      expect(result.content).toHaveLength(2);
    });

    it('should use full component from templateContent for inserts', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Hello' } },
          { type: 'ImageBlock', props: { id: 'img1', src: '/photo.jpg' } },
        ],
      };

      const templateContent = [
        { type: 'HeadingBlock', props: { id: 'h1', title: 'Hello' } },
        { type: 'ImageBlock', props: { id: 'img1', src: '/photo.jpg' } },
        { type: 'ButtonBlock', props: { id: 'btn1', label: 'Click me', href: '/action' } },
      ];

      const result = applyDeltaToSnapshot(
        snapshot,
        [{ type: 'insert', componentType: 'ButtonBlock', destinationIndex: 2 }],
        templateContent,
      );

      const content = result.content as Array<{ type: string; props: Record<string, unknown> }>;
      expect(content).toHaveLength(3);
      expect(content[2].type).toBe('ButtonBlock');
      expect(content[2].props.label).toBe('Click me');
      expect(content[2].props.href).toBe('/action');
      expect(content[2].props.id).toBe('btn1');
    });

    it('should skip insert when component with same props.id already exists', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Hello' } },
          { type: 'ButtonBlock', props: { id: 'btn1', label: 'Existing button' } },
        ],
      };

      const templateContent = [
        { type: 'HeadingBlock', props: { id: 'h1', title: 'Hello' } },
        { type: 'ButtonBlock', props: { id: 'btn1', label: 'Template button' } },
      ];

      const result = applyDeltaToSnapshot(
        snapshot,
        [{ type: 'insert', componentType: 'ButtonBlock', destinationIndex: 1 }],
        templateContent,
      );

      const content = result.content as Array<{ type: string; props: Record<string, unknown> }>;
      expect(content).toHaveLength(2);
      // Should keep the existing document version, not insert duplicate
      expect(content[1].props.label).toBe('Existing button');
    });

    it('should create skeleton component when templateContent is not provided', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [{ type: 'HeadingBlock', props: { id: 'h1' } }],
      };

      const result = applyDeltaToSnapshot(
        snapshot,
        [{ type: 'insert', componentType: 'ButtonBlock', destinationIndex: 1 }],
      );

      const content = result.content as Array<{ type: string; props: Record<string, unknown> }>;
      expect(content).toHaveLength(2);
      expect(content[1].type).toBe('ButtonBlock');
      expect(content[1].props.id).toContain('migrated-');
    });

    it('should apply insert then reorder in sequence', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');
      const snapshot = {
        content: [
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
        ],
      };

      const templateContent = [
        { type: 'C', props: { id: 'c1', value: 'new' } },
        { type: 'A', props: { id: 'a1' } },
        { type: 'B', props: { id: 'b1' } },
      ];

      const result = applyDeltaToSnapshot(
        snapshot,
        [
          { type: 'insert', componentType: 'C', destinationIndex: 0 },
          { type: 'reorder', sourceIndex: 1, destinationIndex: 2 },
        ],
        templateContent,
      );

      const content = result.content as Array<{ type: string; props: Record<string, unknown> }>;
      expect(content).toHaveLength(3);
      expect(content[0].type).toBe('C');
      expect(content[0].props.value).toBe('new');
      expect(content[1].type).toBe('B');
      expect(content[2].type).toBe('A');
    });
  });

  // =========================================================================
  // applyDeltaToDocument
  // =========================================================================

  describe('applyDeltaToDocument', () => {
    it('should apply reorder actions to document snapshot', async () => {
      const { applyDeltaToDocument } = await import('../../src/services/migration-service');
      const { getLatestDocumentVersion, createDocumentVersion } = await import('../../src/services/document-version-service');
      const { validateDocumentStructure } = await import('@pantheon-systems/p1-content-validator');

      const currentSnapshot = {
        content: [
          { type: 'Hero', props: { title: 'Welcome' } },
          { type: 'Body', props: { text: 'Hello' } },
          { type: 'Footer', props: { copyright: '2026' } },
        ],
        root: {},
        zones: {},
      };

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-100',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-789',
        versionNumber: 5,
        snapshot: currentSnapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });

      vi.mocked(validateDocumentStructure).mockReturnValueOnce({ errors: [] });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-101',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-789',
        versionNumber: 6,
        snapshot: currentSnapshot, // Simplified — real impl would have reordered content
        source: 'migration',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      const db = await import('../../src/db');
      // For the UPDATE documents.template_version query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const delta = [
        { type: 'reorder' as const, sourceIndex: 0, destinationIndex: 2 },
      ];

      const result = await applyDeltaToDocument(
        'doc-uuid-123',
        'branch-uuid-789',
        delta,
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.versionId).toBeDefined();
      expect(result.snapshot).toBeDefined();
      expect(getLatestDocumentVersion).toHaveBeenCalledWith('doc-uuid-123', 'branch-uuid-789');
    });

    it('should create new document version with migration source', async () => {
      const { applyDeltaToDocument } = await import('../../src/services/migration-service');
      const { getLatestDocumentVersion, createDocumentVersion } = await import('../../src/services/document-version-service');
      const { validateDocumentStructure } = await import('@pantheon-systems/p1-content-validator');

      const currentSnapshot = {
        content: [{ type: 'Hero' }],
        root: {},
        zones: {},
      };

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-100',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-789',
        versionNumber: 3,
        snapshot: currentSnapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });

      vi.mocked(validateDocumentStructure).mockReturnValueOnce({ errors: [] });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-101',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-789',
        versionNumber: 4,
        snapshot: currentSnapshot,
        source: 'migration',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      const db = await import('../../src/db');
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const delta = [{ type: 'insert' as const, componentType: 'Footer', zone: 'content' }];

      await applyDeltaToDocument(
        'doc-uuid-123',
        'branch-uuid-789',
        delta,
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-789',
          source: 'migration',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      );
    });

    it('should not update template_version (handled by batch update in processMigration)', async () => {
      const { applyDeltaToDocument } = await import('../../src/services/migration-service');
      const { getLatestDocumentVersion, createDocumentVersion } = await import('../../src/services/document-version-service');
      const { validateDocumentStructure } = await import('@pantheon-systems/p1-content-validator');
      const db = await import('../../src/db');

      const currentSnapshot = {
        content: [{ type: 'Hero' }],
        root: {},
        zones: {},
      };

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-100',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-789',
        versionNumber: 2,
        snapshot: currentSnapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });

      vi.mocked(validateDocumentStructure).mockReturnValueOnce({ errors: [] });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-101',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-789',
        versionNumber: 3,
        snapshot: currentSnapshot,
        source: 'migration',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      const delta = [{ type: 'insert' as const, componentType: 'Footer', zone: 'content' }];

      await applyDeltaToDocument(
        'doc-uuid-123',
        'branch-uuid-789',
        delta,
        { id: 'user-uuid-001', type: 'user' },
      );

      // applyDeltaToDocument should NOT call db.query for template_version updates.
      // template_version is now batch-updated in processMigration after each batch.
      const updateCall = vi.mocked(db.query).mock.calls.find(
        (call) => (call[0] as string).toUpperCase().includes('UPDATE'),
      );
      expect(updateCall).toBeUndefined();
    });
  });

  // =========================================================================
  // triggerMigration
  // =========================================================================

  describe('triggerMigration', () => {
    it('should validate fromVersion < toVersion', async () => {
      const { triggerMigration, InvalidVersionRangeError } = await import('../../src/services/migration-service');

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
      const { triggerMigration, InvalidVersionRangeError } = await import('../../src/services/migration-service');

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
      const { triggerMigration, TemplateNotFoundError } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template lookup returns no rows
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

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
      const { triggerMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      // Template exists
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // Count affected documents
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      });

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
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJobRow],
        rowCount: 1,
      });

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
      const { triggerMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      // Template exists
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // Count affected documents
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '10' }],
        rowCount: 1,
      });

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
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJobRow],
        rowCount: 1,
      });

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
      const { triggerMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      // Template exists
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // Count affected documents returns 15
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '15' }],
        rowCount: 1,
      });

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
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJobRow],
        rowCount: 1,
      });

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
      const { triggerMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      // Template exists
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // Count affected documents
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '3' }],
        rowCount: 1,
      });

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
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJobRow],
        rowCount: 1,
      });

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
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { getLatestDocumentVersion, createDocumentVersion } = await import('../../src/services/document-version-service');
      const { validateDocumentStructure } = await import('@pantheon-systems/p1-content-validator');

      const mockJob = createMockMigrationJob({ total_documents: 1 });

      // getMigrationJob: load the job
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta: query structural versions of template
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'reorder', sourceIndex: 0, destinationIndex: 1 },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // findAffectedDocuments: first batch
      const docRow = {
        ...createMockDocument({ id: 'doc-1', template_version: 1 }),
        snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
      };
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [docRow],
        rowCount: 1,
      });

      // detectDocumentConflicts: no structural changes in doc
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // applyDeltaToDocument flow:
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-100',
        documentId: 'doc-1',
        branchId: 'branch-uuid-789',
        versionNumber: 3,
        snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });

      vi.mocked(validateDocumentStructure).mockReturnValueOnce({ errors: [] });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'version-uuid-101',
        documentId: 'doc-1',
        branchId: 'branch-uuid-789',
        versionNumber: 4,
        snapshot: { content: [{ type: 'Body' }, { type: 'Hero' }], root: {}, zones: {} },
        source: 'migration',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      // Update documents.template_version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update progress
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // findAffectedDocuments: second batch returns empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // Mark job as completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await processMigration('job-uuid-123');

      expect(result.processedDocuments).toBeGreaterThanOrEqual(1);
      expect(result.conflictedDocuments).toBe(0);
    });

    it('should route conflicted documents to migration_conflicts table', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockJob = createMockMigrationJob({ total_documents: 1 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'reorder', sourceIndex: 0, destinationIndex: 1, componentType: 'Hero' },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // findAffectedDocuments: first batch
      const docRow = {
        ...createMockDocument({ id: 'doc-conflicted', template_version: 1 }),
        snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
      };
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [docRow],
        rowCount: 1,
      });

      // detectDocumentConflicts: document HAS structural changes that overlap
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'reorder', sourceIndex: 1, destinationIndex: 0, componentType: 'Hero' },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // INSERT into migration_conflicts
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [createMockConflictRow({ document_id: 'doc-conflicted' })],
        rowCount: 1,
      });

      // Update progress
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // findAffectedDocuments: second batch returns empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // Mark job as completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await processMigration('job-uuid-123');

      expect(result.conflictedDocuments).toBeGreaterThanOrEqual(1);
    });

    it('should update processed_documents counter incrementally', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockJob = createMockMigrationJob({ total_documents: 1 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta: no structural changes (empty delta)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // findAffectedDocuments: one doc
      const docRow = {
        ...createMockDocument({ id: 'doc-1', template_version: 1 }),
        snapshot: { content: [], root: {}, zones: {} },
      };
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [docRow],
        rowCount: 1,
      });

      // detectDocumentConflicts: no conflicts
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // applyDeltaToDocument flow
      const { getLatestDocumentVersion, createDocumentVersion } = await import('../../src/services/document-version-service');
      const { validateDocumentStructure } = await import('@pantheon-systems/p1-content-validator');

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-100', documentId: 'doc-1', branchId: 'branch-uuid-789',
        versionNumber: 1, snapshot: { content: [], root: {}, zones: {} },
        source: 'edit', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T09:00:00.000Z',
      });
      vi.mocked(validateDocumentStructure).mockReturnValueOnce({ errors: [] });
      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-101', documentId: 'doc-1', branchId: 'branch-uuid-789',
        versionNumber: 2, snapshot: { content: [], root: {}, zones: {} },
        source: 'migration', createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-08T10:00:00.000Z',
      });

      // Update documents.template_version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update progress (processed_documents increment)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // findAffectedDocuments: empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await processMigration('job-uuid-123');

      // Verify that at least one query updated processed_documents
      const allCalls = vi.mocked(db.query).mock.calls;
      const progressUpdateCall = allCalls.find(
        (call) => {
          const sql = (call[0] as string).toUpperCase();
          return sql.includes('PROCESSED_DOCUMENTS') && sql.includes('UPDATE');
        },
      );
      expect(progressUpdateCall).toBeDefined();
    });

    it('should mark job completed when all documents processed', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockJob = createMockMigrationJob({ total_documents: 0 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta: no structural changes
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // findAffectedDocuments: empty (no documents to process)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await processMigration('job-uuid-123');

      // Verify status update to 'completed'
      const allCalls = vi.mocked(db.query).mock.calls;
      const completedCall = allCalls.find(
        (call) => {
          const sql = (call[0] as string).toLowerCase();
          return sql.includes('completed') && sql.includes('update') && sql.includes('migration_jobs');
        },
      );
      expect(completedCall).toBeDefined();
      expect(result.processedDocuments).toBe(0);
      expect(result.conflictedDocuments).toBe(0);
    });

    it('should process in batches of 50 documents', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockJob = createMockMigrationJob({ total_documents: 0 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // findAffectedDocuments: empty batch
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await processMigration('job-uuid-123');

      // Verify the findAffectedDocuments query used LIMIT 50
      const allCalls = vi.mocked(db.query).mock.calls;
      const findDocsCall = allCalls.find(
        (call) => {
          const sql = (call[0] as string).toUpperCase();
          return sql.includes('LIMIT') && sql.includes('TEMPLATE_ID');
        },
      );
      if (findDocsCall) {
        const params = findDocsCall[1] as unknown[];
        // The limit parameter should be 50
        expect(params).toContain(50);
      }
    });

    it('should set job status to in_progress before processing', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const mockJob = createMockMigrationJob({ total_documents: 0 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // findAffectedDocuments: empty
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await processMigration('job-uuid-123');

      // The second db.query call should be the status update to 'in_progress'
      const secondCall = vi.mocked(db.query).mock.calls[1];
      const sql = (secondCall[0] as string).toLowerCase();
      expect(sql).toContain('update');
      expect(sql).toContain('in_progress');
    });

    it('should succeed when document has null snapshot by falling back to reconstructVersionSnapshot', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const {
        getLatestDocumentVersion,
        createDocumentVersion,
        reconstructVersionSnapshot,
      } = await import('../../src/services/document-version-service');

      const mockJob = createMockMigrationJob({ total_documents: 1 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'insert', componentType: 'CTA', destinationIndex: 2 },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // reconstructVersionSnapshot for extractTemplateDelta (fromVersion and toVersion)
      const templateFromSnap = { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} };
      const templateToSnap = { content: [{ type: 'Hero' }, { type: 'Body' }, { type: 'CTA' }], root: {}, zones: {} };
      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce(templateFromSnap)
        .mockResolvedValueOnce(templateToSnap);

      // reconstructVersionSnapshot for template (called by processMigration for templateContent)
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce(templateToSnap);

      // findAffectedDocuments: document with null snapshot from CRDT edit
      const docRow = {
        ...createMockDocument({ id: 'doc-crdt', template_version: 1 }),
        snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
      };
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [docRow],
        rowCount: 1,
      });

      // detectDocumentConflicts: no conflicts
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // applyDeltaToDocument: getLatestDocumentVersion returns null snapshot
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-200', documentId: 'doc-crdt', branchId: 'branch-uuid-789',
        versionNumber: 3,
        snapshot: null as unknown as Record<string, unknown>,
        source: 'edit' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
      });

      // reconstructVersionSnapshot for document fallback
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce({
        content: [{ type: 'Hero' }, { type: 'Body' }],
        root: {},
        zones: {},
      });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-201', documentId: 'doc-crdt', branchId: 'branch-uuid-789',
        versionNumber: 4,
        snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }, { type: 'CTA' }], root: {}, zones: {} },
        source: 'migration' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:01:00.000Z',
      });

      // Update documents.template_version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update progress
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // findAffectedDocuments: empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await processMigration('job-uuid-123');

      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(0);
      expect(reconstructVersionSnapshot).toHaveBeenCalledWith('doc-crdt', 'branch-uuid-789', 3);
      expect(createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'migration' }),
      );
    });

    it('should record conflict when document snapshot cannot be reconstructed', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const {
        getLatestDocumentVersion,
        reconstructVersionSnapshot,
      } = await import('../../src/services/document-version-service');

      const mockJob = createMockMigrationJob({ total_documents: 1 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1 }],
            },
          }),
        ],
        rowCount: 1,
      });

      // reconstructVersionSnapshot for template
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce({
        content: [{ type: 'Hero' }, { type: 'Body' }],
        root: {},
      });

      // findAffectedDocuments
      const docRow = {
        ...createMockDocument({ id: 'doc-broken', template_version: 1 }),
        snapshot: null,
      };
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [docRow],
        rowCount: 1,
      });

      // detectDocumentConflicts: no conflicts
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // applyDeltaToDocument: null snapshot, reconstruction also fails
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-300', documentId: 'doc-broken', branchId: 'branch-uuid-789',
        versionNumber: 2,
        snapshot: null as unknown as Record<string, unknown>,
        source: 'edit' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
      });
      // reconstructVersionSnapshot for document also fails
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce(null);

      // INSERT into migration_conflicts (catch block)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update progress
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // findAffectedDocuments: empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await processMigration('job-uuid-123');

      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(1);
    });

    it('should pass templateContent to applyDeltaToDocument for insert lookups', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const {
        getLatestDocumentVersion,
        createDocumentVersion,
        reconstructVersionSnapshot,
      } = await import('../../src/services/document-version-service');

      const templateSnapshot = {
        content: [
          { type: 'Hero', props: { title: 'Default' } },
          { type: 'Body', props: {} },
          { type: 'CTA', props: { label: 'Click' } },
        ],
        root: {},
      };

      const mockJob = createMockMigrationJob({ total_documents: 1 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'insert', componentType: 'CTA', destinationIndex: 2 },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // reconstructVersionSnapshot for template (called to get templateContent)
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce(templateSnapshot);

      // findAffectedDocuments
      const docRow = {
        ...createMockDocument({ id: 'doc-tc', template_version: 1 }),
        snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
      };
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [docRow],
        rowCount: 1,
      });

      // detectDocumentConflicts: no conflicts
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // applyDeltaToDocument
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-400', documentId: 'doc-tc', branchId: 'branch-uuid-789',
        versionNumber: 2,
        snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
        source: 'edit' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
      });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-401', documentId: 'doc-tc', branchId: 'branch-uuid-789',
        versionNumber: 3,
        snapshot: templateSnapshot,
        source: 'migration' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:01:00.000Z',
      });

      // Update documents.template_version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update progress
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // findAffectedDocuments: empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await processMigration('job-uuid-123');

      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(0);
      // Verify reconstructVersionSnapshot was called for the template
      expect(reconstructVersionSnapshot).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // rollbackMigration
  // =========================================================================

  describe('rollbackMigration', () => {
    it('should revert using checkpoint when checkpoint_id exists', async () => {
      const { rollbackMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const mockJob = createMockMigrationJob({
        checkpoint_id: 'checkpoint-uuid-999',
        status: 'completed',
        total_documents: 5,
      });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

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
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 5 });

      // Mark job as 'failed'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

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
      const { rollbackMigration, MigrationJobNotFoundError } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await expect(
        rollbackMigration(
          'nonexistent-job',
          { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow(MigrationJobNotFoundError);
    });

    it('should restore template_version on affected documents', async () => {
      const { rollbackMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const mockJob = createMockMigrationJob({
        checkpoint_id: 'checkpoint-uuid-999',
        from_version: 1,
        to_version: 2,
      });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

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

      // Reset template_version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 3 });

      // Mark job as 'failed'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await rollbackMigration(
        'job-uuid-123',
        { id: 'user-uuid-001', type: 'user' },
      );

      // Verify template_version was reset
      const allCalls = vi.mocked(db.query).mock.calls;
      const resetCall = allCalls.find(
        (call) => {
          const sql = (call[0] as string).toLowerCase();
          return sql.includes('template_version') && sql.includes('update');
        },
      );
      expect(resetCall).toBeDefined();
    });

    it('should mark job as failed', async () => {
      const { rollbackMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const mockJob = createMockMigrationJob({
        checkpoint_id: 'checkpoint-uuid-999',
      });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

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

      // Reset template_version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 2 });

      // Mark job as 'failed'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await rollbackMigration(
        'job-uuid-123',
        { id: 'user-uuid-001', type: 'user' },
      );

      // Verify job was marked as 'failed'
      const allCalls = vi.mocked(db.query).mock.calls;
      const failedCall = allCalls.find(
        (call) => {
          const sql = (call[0] as string).toLowerCase();
          return sql.includes('failed') && sql.includes('migration_jobs');
        },
      );
      expect(failedCall).toBeDefined();
    });

    it('should handle rollback when no checkpoint exists (legacy path)', async () => {
      const { rollbackMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const mockJob = createMockMigrationJob({
        checkpoint_id: null,
        from_version: 1,
        to_version: 2,
      });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Delete migration versions (legacy path)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 3 });

      // Reset template_version on affected docs
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 3 });

      // Mark job as 'failed'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

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
      const { resolveMigrationConflict } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { getLatestDocumentVersion, createDocumentVersion } = await import('../../src/services/document-version-service');
      const { validateDocumentStructure } = await import('@pantheon-systems/p1-content-validator');

      const conflictRow = createMockConflictRow({
        template_delta: [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1 }],
      });

      // Load conflict by ID
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [conflictRow],
        rowCount: 1,
      });

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
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update conflict: set resolution='apply', resolved_at
      const resolvedConflict = createMockConflictRow({
        resolution: 'apply',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [resolvedConflict],
        rowCount: 1,
      });

      const result = await resolveMigrationConflict(
        'conflict-uuid-001',
        'apply',
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.resolution).toBe('apply');
      expect(result.resolvedAt).toBeDefined();
    });

    it('should record resolution only when strategy is "skip"', async () => {
      const { resolveMigrationConflict } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { createDocumentVersion } = await import('../../src/services/document-version-service');

      const conflictRow = createMockConflictRow();

      // Load conflict by ID
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [conflictRow],
        rowCount: 1,
      });

      // Update conflict: set resolution='skip', resolved_at
      const resolvedConflict = createMockConflictRow({
        resolution: 'skip',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [resolvedConflict],
        rowCount: 1,
      });

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
      const { resolveMigrationConflict } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { createDocumentVersion } = await import('../../src/services/document-version-service');

      const conflictRow = createMockConflictRow();

      // Load conflict by ID
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [conflictRow],
        rowCount: 1,
      });

      // Update conflict: set resolution='manual', resolved_at
      const resolvedConflict = createMockConflictRow({
        resolution: 'manual',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [resolvedConflict],
        rowCount: 1,
      });

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
      const { resolveMigrationConflict } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      const conflictRow = createMockConflictRow();

      // Load conflict
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [conflictRow],
        rowCount: 1,
      });

      // Update conflict with resolved_at
      const resolvedConflict = createMockConflictRow({
        resolution: 'skip',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [resolvedConflict],
        rowCount: 1,
      });

      const result = await resolveMigrationConflict(
        'conflict-uuid-001',
        'skip',
        { id: 'user-uuid-001', type: 'user' },
      );

      expect(result.resolvedAt).not.toBeNull();

      // Verify the update query sets resolved_at
      const allCalls = vi.mocked(db.query).mock.calls;
      const updateCall = allCalls.find(
        (call) => {
          const sql = (call[0] as string).toLowerCase();
          return sql.includes('resolved_at') && sql.includes('update');
        },
      );
      expect(updateCall).toBeDefined();
    });

    it('should update template_version on apply resolution', async () => {
      const { resolveMigrationConflict } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const { getLatestDocumentVersion, createDocumentVersion } = await import('../../src/services/document-version-service');
      const { validateDocumentStructure } = await import('@pantheon-systems/p1-content-validator');

      const conflictRow = createMockConflictRow({
        from_version: 1,
        to_version: 2,
        template_delta: [{ type: 'insert', componentType: 'Footer', zone: 'content' }],
      });

      // Load conflict
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [conflictRow],
        rowCount: 1,
      });

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

      // Update documents.template_version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update conflict record
      const resolvedConflict = createMockConflictRow({
        resolution: 'apply',
        resolved_at: '2026-06-08T12:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [resolvedConflict],
        rowCount: 1,
      });

      await resolveMigrationConflict(
        'conflict-uuid-001',
        'apply',
        { id: 'user-uuid-001', type: 'user' },
      );

      // Verify template_version was updated
      const allCalls = vi.mocked(db.query).mock.calls;
      const templateVersionCall = allCalls.find(
        (call) => {
          const sql = (call[0] as string).toLowerCase();
          return sql.includes('template_version') && sql.includes('update') && sql.includes('documents');
        },
      );
      expect(templateVersionCall).toBeDefined();
    });
  });

  // =========================================================================
  // getMigrationStatus
  // =========================================================================

  describe('getMigrationStatus', () => {
    it('should return migration status with stale documents', async () => {
      const { getMigrationStatus } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template version lookup returns version 5
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 5 }],
        rowCount: 1,
      });

      // Stale document count and oldest version
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '12', oldest_version: 2 }],
        rowCount: 1,
      });

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.currentVersion).toBe(5);
      expect(result.staleDocumentCount).toBe(12);
      expect(result.oldestDocumentVersion).toBe(2);
      expect(result.migrationAvailable).toBe(true);
    });

    it('should return migrationAvailable: false when no stale documents', async () => {
      const { getMigrationStatus } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template version lookup returns version 3
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 3 }],
        rowCount: 1,
      });

      // No stale documents
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '0', oldest_version: null }],
        rowCount: 1,
      });

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.staleDocumentCount).toBe(0);
      expect(result.oldestDocumentVersion).toBeNull();
      expect(result.migrationAvailable).toBe(false);
    });

    it('should throw TemplateNotFoundError when template does not exist', async () => {
      const { getMigrationStatus, TemplateNotFoundError } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template version lookup returns no rows
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await expect(
        getMigrationStatus('nonexistent-template', 'branch-uuid-789'),
      ).rejects.toThrow(TemplateNotFoundError);
    });

    it('should handle documents with null template_version', async () => {
      const { getMigrationStatus } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template version lookup returns version 1
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 1 }],
        rowCount: 1,
      });

      // Documents with null template_version are still counted as stale (null < 1)
      // The SQL MIN(template_version) returns null when all values are null
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '3', oldest_version: null }],
        rowCount: 1,
      });

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.staleDocumentCount).toBe(3);
      expect(result.oldestDocumentVersion).toBeNull();
      expect(result.migrationAvailable).toBe(true);
    });
  });

  // =========================================================================
  // previewMigration
  // =========================================================================

  describe('previewMigration', () => {
    it('should return summary preview with affected docs and conflicts', async () => {
      const { previewMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // 1. Version range validation passes (fromVersion=2 < toVersion=5)
      // 2. Template exists check
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // 3. extractTemplateDelta: query structural versions of template
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'reorder', sourceIndex: 0, destinationIndex: 1, componentType: 'Hero' },
                { type: 'insert', componentType: 'Footer', zone: 'content' },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // 4. findAffectedDocuments: first batch returns 3 docs
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            ...createMockDocument({ id: 'doc-1', path: '/blog/post-1', template_version: 2 }),
            snapshot: { content: [{ type: 'Hero' }], root: {}, zones: {} },
          },
          {
            ...createMockDocument({ id: 'doc-2', path: '/blog/post-2', template_version: 3 }),
            snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
          },
          {
            ...createMockDocument({ id: 'doc-3', path: '/blog/post-3', template_version: 2 }),
            snapshot: { content: [{ type: 'Body' }], root: {}, zones: {} },
          },
        ],
        rowCount: 3,
      });

      // 5. detectDocumentConflicts for doc-1: last migration version lookup + no conflicts
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // 6. detectDocumentConflicts for doc-2: last migration version lookup + HAS conflict
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'reorder', sourceIndex: 1, destinationIndex: 0, componentType: 'Hero' },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // 7. detectDocumentConflicts for doc-3: last migration version lookup + no conflicts
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // 8. findAffectedDocuments: second batch returns empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await previewMigration(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        2,
        5,
        false,
      );

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.fromVersion).toBe(2);
      expect(result.toVersion).toBe(5);
      expect(result.templateDelta).toHaveLength(2);
      expect(result.affectedDocuments).toBe(3);
      expect(result.estimatedConflicts).toBe(1);
      expect(result.cleanDocuments).toBe(2);
      // Summary mode: no documents array
      expect(result.documents).toBeUndefined();
    });

    it('should return detailed preview with per-document info when detail=true', async () => {
      const { previewMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template exists check
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'reorder', sourceIndex: 0, destinationIndex: 1 },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // findAffectedDocuments: first batch returns 2 docs
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            ...createMockDocument({ id: 'doc-clean', path: '/blog/clean', template_version: 2 }),
            snapshot: { content: [{ type: 'Hero' }, { type: 'Body' }], root: {}, zones: {} },
          },
          {
            ...createMockDocument({ id: 'doc-conflict', path: '/blog/conflict', template_version: 3 }),
            snapshot: { content: [{ type: 'Hero' }, { type: 'Footer' }], root: {}, zones: {} },
          },
        ],
        rowCount: 2,
      });

      // detectDocumentConflicts for doc-clean: last migration version lookup + no conflicts
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // detectDocumentConflicts for doc-conflict: last migration version lookup + HAS conflict
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'insert', componentType: 'Banner', zone: 'content' },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // findAffectedDocuments: second batch returns empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await previewMigration(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        2,
        5,
        true,
      );

      expect(result.affectedDocuments).toBe(2);
      expect(result.estimatedConflicts).toBe(1);
      expect(result.cleanDocuments).toBe(1);

      // Detailed mode: documents array is present
      expect(result.documents).toBeDefined();
      expect(result.documents).toHaveLength(2);

      // Clean document should have proposedSnapshot and no conflictDetails
      const docs = result.documents ?? [];
      const cleanDoc = docs.find((d) => d.documentId === 'doc-clean');
      expect(cleanDoc).toBeDefined();
      expect(cleanDoc?.path).toBe('/blog/clean');
      expect(cleanDoc?.currentTemplateVersion).toBe(2);
      expect(cleanDoc?.hasConflict).toBe(false);
      expect(cleanDoc?.proposedSnapshot).toBeDefined();
      expect(cleanDoc?.conflictDetails).toBeUndefined();

      // Conflicted document should have conflictDetails and no proposedSnapshot
      const conflictDoc = docs.find((d) => d.documentId === 'doc-conflict');
      expect(conflictDoc).toBeDefined();
      expect(conflictDoc?.path).toBe('/blog/conflict');
      expect(conflictDoc?.currentTemplateVersion).toBe(3);
      expect(conflictDoc?.hasConflict).toBe(true);
      expect(conflictDoc?.conflictDetails).toBeDefined();
      expect(conflictDoc?.conflictDetails?.templateDelta).toBeDefined();
      expect(conflictDoc?.conflictDetails?.documentActions).toBeDefined();
      expect(conflictDoc?.proposedSnapshot).toBeUndefined();
    });

    it('should return empty preview when no documents are affected', async () => {
      const { previewMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template exists check
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // extractTemplateDelta: returns some actions
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'insert', componentType: 'Footer', zone: 'content' },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // findAffectedDocuments: returns empty (no docs affected)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await previewMigration(
        'site-uuid-456',
        'branch-uuid-789',
        'template-uuid-001',
        1,
        3,
        false,
      );

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(3);
      expect(result.templateDelta).toHaveLength(1);
      expect(result.affectedDocuments).toBe(0);
      expect(result.estimatedConflicts).toBe(0);
      expect(result.cleanDocuments).toBe(0);
      expect(result.documents).toBeUndefined();
    });

    it('should throw TemplateNotFoundError when template not found', async () => {
      const { previewMigration, TemplateNotFoundError } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template does not exist
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

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
      const { previewMigration, InvalidVersionRangeError } = await import('../../src/services/migration-service');

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
      const { triggerMigration, TemplateNotFoundError } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template lookup returns empty
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

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
        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
        });
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
      const { triggerMigration, InvalidVersionRangeError } = await import('../../src/services/migration-service');

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
      const { getMigrationJob, MigrationJobNotFoundError } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(getMigrationJob('nonexistent')).rejects.toThrow(MigrationJobNotFoundError);

      try {
        vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
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
      const { getMigrationStatus } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // First query: get latest version number
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 3 }],
        rowCount: 1,
      });

      // Second query: count stale documents
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '5', oldest_version: 1 }],
        rowCount: 1,
      });

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.templateId).toBe('template-uuid-001');
      expect(result.currentVersion).toBe(3);
      expect(result.staleDocumentCount).toBe(5);
      expect(result.oldestDocumentVersion).toBe(1);
      expect(result.migrationAvailable).toBe(true);
    });

    it('should return migrationAvailable false when no stale documents', async () => {
      const { getMigrationStatus } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 2 }],
        rowCount: 1,
      });

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '0', oldest_version: null }],
        rowCount: 1,
      });

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.staleDocumentCount).toBe(0);
      expect(result.oldestDocumentVersion).toBeNull();
      expect(result.migrationAvailable).toBe(false);
    });

    it('should throw TemplateNotFoundError when template has no versions', async () => {
      const { getMigrationStatus } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await expect(
        getMigrationStatus('missing-template', 'branch-uuid-789'),
      ).rejects.toThrow();
    });

    it('should query with NULL-aware stale document detection', async () => {
      const { getMigrationStatus } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ version_number: 2 }],
        rowCount: 1,
      });

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ count: '3', oldest_version: 0 }],
        rowCount: 1,
      });

      const result = await getMigrationStatus('template-uuid-001', 'branch-uuid-789');

      expect(result.staleDocumentCount).toBe(3);
      expect(result.oldestDocumentVersion).toBe(0);

      // Verify the stale query uses IS NULL check
      const staleQuery = vi.mocked(db.query).mock.calls[1][0];
      expect(staleQuery).toContain('IS NULL');
    });
  });

  // =========================================================================
  // previewMigration
  // =========================================================================

  describe('previewMigration', () => {
    it('should return summary preview without detail', async () => {
      const { previewMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template existence check
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // extractTemplateDelta: version query
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            version_number: 2,
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'insert', componentType: 'CTA', destinationIndex: 2 },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // findAffectedDocuments: first batch
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-uuid-001',
            site_id: 'site-uuid-456',
            path: 'pages/home',
            template_id: 'template-uuid-001',
            template_version: 1,
            snapshot: { content: [{ type: 'Hero' }] },
          },
        ],
        rowCount: 1,
      });

      // detectDocumentConflicts: last migration version lookup + document action query
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // findAffectedDocuments: second batch (empty = end)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
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
      const { previewMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template existence check
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            version_number: 2,
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'insert', componentType: 'Footer', destinationIndex: 1 },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // findAffectedDocuments: one doc
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-uuid-001',
            site_id: 'site-uuid-456',
            path: 'pages/about',
            template_id: 'template-uuid-001',
            template_version: 1,
            snapshot: { content: [{ type: 'Hero', props: {} }] },
          },
        ],
        rowCount: 1,
      });

      // detectDocumentConflicts: last migration version lookup + no conflict
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // findAffectedDocuments: end
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
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
      // The proposed snapshot should have the Footer inserted
      const content = result.documents?.[0].proposedSnapshot?.content as { type: string }[];
      expect(content).toHaveLength(2);
      expect(content[1].type).toBe('Footer');
    });

    it('should throw when fromVersion >= toVersion', async () => {
      const { previewMigration } = await import('../../src/services/migration-service');

      await expect(
        previewMigration(
          'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 3, 2, false,
        ),
      ).rejects.toThrow();
    });

    it('should throw TemplateNotFoundError when template does not exist', async () => {
      const { previewMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await expect(
        previewMigration(
          'site-uuid-456', 'branch-uuid-789', 'missing-template', 1, 2, false,
        ),
      ).rejects.toThrow();
    });

    it('should return zero affected when no stale documents exist', async () => {
      const { previewMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Template exists
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'template-uuid-001' }],
        rowCount: 1,
      });

      // extractTemplateDelta
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // findAffectedDocuments: empty
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await previewMigration(
        'site-uuid-456', 'branch-uuid-789', 'template-uuid-001', 1, 2, false,
      );

      expect(result.affectedDocuments).toBe(0);
      expect(result.estimatedConflicts).toBe(0);
      expect(result.cleanDocuments).toBe(0);
    });
  });

  // =========================================================================
  // Null snapshot handling
  // =========================================================================

  describe('null snapshot handling', () => {
    it('applyDeltaToSnapshot should return empty object for null snapshot', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const result = applyDeltaToSnapshot(
        null as unknown as Record<string, unknown>,
        [{ type: 'insert', componentType: 'Hero', destinationIndex: 0 }],
      );

      expect(result).toEqual({});
    });

    it('applyDeltaToSnapshot should return empty object for undefined snapshot', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const result = applyDeltaToSnapshot(
        undefined as unknown as Record<string, unknown>,
        [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1 }],
      );

      expect(result).toEqual({});
    });

    it('applyDeltaToDocument should fall back to reconstructVersionSnapshot when latest has null snapshot', async () => {
      const { applyDeltaToDocument } = await import('../../src/services/migration-service');
      const {
        getLatestDocumentVersion,
        createDocumentVersion,
        reconstructVersionSnapshot,
      } = await import('../../src/services/document-version-service');

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
        source: 'migration' as DocumentVersionSource,
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-06-18T10:01:00.000Z',
      });

      const delta = [
        { type: 'insert' as const, componentType: 'Footer', destinationIndex: 2 },
      ];

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
      const { applyDeltaToDocument } = await import('../../src/services/migration-service');
      const {
        getLatestDocumentVersion,
        reconstructVersionSnapshot,
      } = await import('../../src/services/document-version-service');

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
          [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1 }],
          { id: 'user-uuid-001', type: 'user' },
        ),
      ).rejects.toThrow('No snapshot found for document doc-no-snap');
    });
  });

  // =========================================================================
  // snapshot_sync action type (snapshot-diff fallback)
  // =========================================================================

  describe('applyDeltaToSnapshot: snapshot_sync action', () => {
    it('should add components that were added to the template', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        root: { props: { title: 'My page' } },
        content: [
          { type: 'Hero', props: { id: 'hero-1', title: 'Welcome' } },
          { type: 'Body', props: { id: 'body-1', text: 'Hello' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1', title: '' } },
        { type: 'Body', props: { id: 'body-1', text: '' } },
      ];

      const toContent = [
        { type: 'Hero', props: { id: 'hero-1', title: '' } },
        { type: 'Body', props: { id: 'body-1', text: '' } },
        { type: 'ButtonBlock', props: { id: 'btn-new', label: 'Learn more' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      expect(content).toHaveLength(3);
      expect(content[0].type).toBe('Hero');
      expect(content[0].props.title).toBe('Welcome');
      expect(content[1].type).toBe('Body');
      expect(content[2].type).toBe('ButtonBlock');
      expect(content[2].props.id).toBe('btn-new');
    });

    it('should remove components that were removed from the template', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'hero-1' } },
          { type: 'Body', props: { id: 'body-1' } },
          { type: 'Footer', props: { id: 'footer-1' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
        { type: 'Footer', props: { id: 'footer-1' } },
      ];

      const toContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string }>;
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe('Hero');
      expect(content[1].type).toBe('Body');
    });

    it('should preserve document-specific components not in the template', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'hero-1' } },
          { type: 'CustomWidget', props: { id: 'widget-user-added' } },
          { type: 'Body', props: { id: 'body-1' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
      ];

      const toContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
        { type: 'Footer', props: { id: 'footer-new' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      expect(content).toHaveLength(4);
      expect(content.map(c => c.type)).toEqual(['Hero', 'CustomWidget', 'Body', 'Footer']);
    });

    it('should handle complete content replacement (all old removed, all new added)', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'OldHero', props: { id: 'old-1' } },
          { type: 'OldBody', props: { id: 'old-2' } },
        ],
      };

      const fromContent = [
        { type: 'OldHero', props: { id: 'old-1' } },
        { type: 'OldBody', props: { id: 'old-2' } },
      ];

      const toContent = [
        { type: 'ImageBlock', props: { id: 'img-new', src: 'photo.jpg' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('ImageBlock');
      expect(content[0].props.id).toBe('img-new');
    });

    it('should handle empty fromContent (fresh template)', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [],
      };

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent: [], toContent: [
          { type: 'Hero', props: { id: 'hero-new' } },
        ]},
      ]);

      const content = result.content as Array<{ type: string }>;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('Hero');
    });
  });

  // =========================================================================
  // extractTemplateDelta: snapshot-diff fallback
  // =========================================================================

  describe('extractTemplateDelta: snapshot-diff fallback', () => {
    it('should fall back to snapshot diff when versions have derived:true (no puckActions)', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      // Query returns structural versions but with no puckActions (derived:true)
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: { derived: true },
          }),
        ],
        rowCount: 1,
      });

      // reconstructVersionSnapshot for fromVersion
      vi.mocked(dvs.reconstructVersionSnapshot).mockResolvedValueOnce({
        content: [
          { type: 'Hero', props: { id: 'hero-1' } },
        ],
      });

      // reconstructVersionSnapshot for toVersion
      vi.mocked(dvs.reconstructVersionSnapshot).mockResolvedValueOnce({
        content: [
          { type: 'Hero', props: { id: 'hero-1' } },
          { type: 'ButtonBlock', props: { id: 'btn-1', label: 'Click me' } },
        ],
      });

      const result = await extractTemplateDelta('tmpl-1', 'branch-1', 1, 3);

      expect(result.structuralActions).toHaveLength(1);
      expect(result.structuralActions[0].type).toBe('snapshot_sync');
      expect(result.structuralActions[0].fromContent).toBeDefined();
      expect(result.structuralActions[0].toContent).toBeDefined();
    });

    it('should prefer explicit puckActions over snapshot diff for structural', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [{ type: 'insert', componentType: 'Hero', destinationIndex: 0 }],
            },
          }),
        ],
        rowCount: 1,
      });

      // Still reconstructs snapshots for prop patch extraction
      const sameSnapshot = { content: [{ type: 'Hero', props: { id: 'h1' } }], root: { props: {} }, zones: {} };
      vi.mocked(dvs.reconstructVersionSnapshot)
        .mockResolvedValueOnce(sameSnapshot)
        .mockResolvedValueOnce(sameSnapshot);

      const result = await extractTemplateDelta('tmpl-1', 'branch-1', 1, 2);

      expect(result.structuralActions).toEqual([{ type: 'insert', componentType: 'Hero', destinationIndex: 0 }]);
    });

    it('should return empty array when snapshots are identical', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: { derived: true },
          }),
        ],
        rowCount: 1,
      });

      const sameContent = { content: [{ type: 'Hero', props: { id: 'h1' } }] };
      vi.mocked(dvs.reconstructVersionSnapshot)
        .mockResolvedValueOnce(sameContent)
        .mockResolvedValueOnce(sameContent);

      const result = await extractTemplateDelta('tmpl-1', 'branch-1', 1, 2);

      expect(result).toEqual({ structuralActions: [], propPatches: [] });
    });
  });

  // =========================================================================
  // Prop Patch Extraction and Application
  // =========================================================================

  describe('extractTemplateDelta: prop patch extraction', () => {
    it('should return propPatches when template props change (no structural)', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      // No structural versions
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Reconstruct snapshots: prop values changed on existing component
      vi.mocked(dvs.reconstructVersionSnapshot)
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

      expect(result.structuralActions).toEqual([]);
      expect(result.propPatches).toHaveLength(1);
      expect(result.propPatches[0].componentId).toBe('h1');
      expect(result.propPatches[0].operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: 'replace', path: '/title', value: 'New Title' }),
        ]),
      );
    });

    it('should return both structural and prop changes together', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      // One structural version with insert action
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          createMockDocumentVersion({
            action_type: 'structural',
            action_metadata: {
              puckActions: [
                { type: 'insert', componentType: 'Footer', destinationIndex: 1 },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

      // Snapshots: Hero props changed AND Footer added
      vi.mocked(dvs.reconstructVersionSnapshot)
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

      expect(result.structuralActions).toHaveLength(1);
      expect(result.structuralActions[0].type).toBe('insert');
      expect(result.propPatches).toHaveLength(1);
      expect(result.propPatches[0].componentId).toBe('h1');
    });

    it('should capture root prop changes', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(dvs.reconstructVersionSnapshot)
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

      expect(result.structuralActions).toEqual([]);
      expect(result.propPatches).toHaveLength(1);
      expect(result.propPatches[0].componentId).toBe('__root__');
      expect(result.propPatches[0].operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: 'replace', path: '/title', value: 'New Site' }),
        ]),
      );
    });

    it('should capture zone component prop changes', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      vi.mocked(dvs.reconstructVersionSnapshot)
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
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Default Title' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [], undefined, {
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

      const hero = (result.content as Array<{ props: { title: string } }>)[0];
      expect(hero.props.title).toBe('Updated Title');
    });

    it('should skip prop patches when document has customized value', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'My Custom Title' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [], undefined, {
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

      const hero = (result.content as Array<{ props: { title: string } }>)[0];
      expect(hero.props.title).toBe('My Custom Title');
    });

    it('should handle mixed customized and default props on same component', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Custom', subtitle: 'Default Sub' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [], undefined, {
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

      const hero = (result.content as Array<{ props: { title: string; subtitle: string } }>)[0];
      expect(hero.props.title).toBe('Custom');
      expect(hero.props.subtitle).toBe('New Sub');
    });

    it('should skip prop patches when component was removed from document', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [
          { type: 'Body', props: { id: 'b1', text: 'Hello' } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [], undefined, {
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
      const body = (result.content as Array<{ props: { id: string } }>)[0];
      expect(body.props.id).toBe('b1');
    });

    it('should apply nested prop changes (e.g., links array)', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [
          { type: 'Footer', props: { id: 'f1', links: [{ text: 'Home', url: '/' }] } },
        ],
      };

      const result = applyDeltaToSnapshot(snapshot, [], undefined, {
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

      const footer = (result.content as Array<{ props: { links: unknown[] } }>)[0];
      expect(footer.props.links).toHaveLength(2);
    });

    it('should apply root prop patches', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [],
        root: { props: { title: 'Old Page Title' } },
      };

      const result = applyDeltaToSnapshot(snapshot, [], undefined, {
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
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [],
        zones: {
          sidebar: [{ type: 'Widget', props: { id: 'w1', color: 'red' } }],
        },
      };

      const result = applyDeltaToSnapshot(snapshot, [], undefined, {
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

      const zones = result.zones as { sidebar: Array<{ props: { color: string } }> };
      expect(zones.sidebar[0].props.color).toBe('blue');
    });
  });

  describe('detectDocumentConflicts: prop conflicts', () => {
    it('should flag prop conflicts when document has customized a prop the template also changed', async () => {
      const { detectDocumentConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Last migration version lookup
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      // No structural document versions
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await detectDocumentConflicts(
        'doc-1', 'branch-1', [], 1, 2,
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
          documentSnapshot: {
            content: [
              { type: 'Hero', props: { id: 'h1', title: 'Custom User Title' } },
            ],
          },
        },
      );

      expect(result).not.toBeNull();
      expect(result!.hasConflict).toBe(false);
      expect(result!.propConflicts).toHaveLength(1);
      expect(result!.propConflicts![0]).toEqual(expect.objectContaining({
        componentId: 'h1',
        propPath: '/title',
      }));
    });

    it('should return no prop conflict when document uses template defaults', async () => {
      const { detectDocumentConflicts } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');

      // Last migration version lookup
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await detectDocumentConflicts(
        'doc-1', 'branch-1', [], 1, 2,
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
          documentSnapshot: {
            content: [
              { type: 'Hero', props: { id: 'h1', title: 'Old Title' } },
            ],
          },
        },
      );

      // No structural or prop conflicts — returns null (clean document)
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // applyDeltaToSnapshot: snapshot_sync reorder
  // =========================================================================

  describe('applyDeltaToSnapshot: snapshot_sync reorder', () => {
    it('should reorder shared components to match template target order', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Heading', props: { id: 'h1', title: 'My Page' } },
          { type: 'Divider', props: { id: 'd1' } },
          { type: 'Button', props: { id: 'b2', label: 'Click' } },
          { type: 'List', props: { id: 'list1', items: ['a', 'b'] } },
        ],
      };

      const fromContent = [
        { type: 'Heading', props: { id: 'h1' } },
        { type: 'Divider', props: { id: 'd1' } },
        { type: 'Button', props: { id: 'b2' } },
        { type: 'List', props: { id: 'list1' } },
      ];

      // Template reorders: Button(b2) moves after List
      const toContent = [
        { type: 'Heading', props: { id: 'h1' } },
        { type: 'Divider', props: { id: 'd1' } },
        { type: 'List', props: { id: 'list1' } },
        { type: 'Button', props: { id: 'b2' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      expect(content).toHaveLength(4);
      expect(content.map(c => c.props.id)).toEqual(['h1', 'd1', 'list1', 'b2']);
      // Verify document props are preserved (not replaced by template defaults)
      expect(content[0].props.title).toBe('My Page');
      expect(content[3].props.label).toBe('Click');
    });

    it('should preserve document-specific components anchored to their neighbors', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      // Document has user-added Image and custom Button between template components
      const docSnapshot = {
        content: [
          { type: 'Heading', props: { id: 'h1' } },
          { type: 'Image', props: { id: 'img-user', src: 'photo.jpg' } },
          { type: 'Button', props: { id: 'btn-user', label: 'Custom' } },
          { type: 'Divider', props: { id: 'd1' } },
          { type: 'Button', props: { id: 'b2', label: 'B2' } },
          { type: 'List', props: { id: 'list1' } },
        ],
      };

      const fromContent = [
        { type: 'Heading', props: { id: 'h1' } },
        { type: 'Divider', props: { id: 'd1' } },
        { type: 'Button', props: { id: 'b2' } },
        { type: 'List', props: { id: 'list1' } },
      ];

      // Template reorders: Button(b2) moves after List
      const toContent = [
        { type: 'Heading', props: { id: 'h1' } },
        { type: 'Divider', props: { id: 'd1' } },
        { type: 'List', props: { id: 'list1' } },
        { type: 'Button', props: { id: 'b2' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      // User-added components should stay anchored after Heading
      expect(content.map(c => c.props.id)).toEqual([
        'h1', 'img-user', 'btn-user', 'd1', 'list1', 'b2',
      ]);
    });

    it('should handle combined add + delete + reorder in a single snapshot_sync', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'hero-1' } },
          { type: 'OldWidget', props: { id: 'old-w' } },
          { type: 'Body', props: { id: 'body-1' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'OldWidget', props: { id: 'old-w' } },
        { type: 'Body', props: { id: 'body-1' } },
      ];

      // Template: removes OldWidget, adds Footer, reorders Body before Hero
      const toContent = [
        { type: 'Body', props: { id: 'body-1' } },
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Footer', props: { id: 'footer-new', text: 'Copyright' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      expect(content).toHaveLength(3);
      expect(content.map(c => c.props.id)).toEqual(['body-1', 'hero-1', 'footer-new']);
    });

    it('should handle document that removed a template component', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      // Document is missing Body (user deleted it)
      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'hero-1' } },
          { type: 'Footer', props: { id: 'footer-1' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
        { type: 'Footer', props: { id: 'footer-1' } },
      ];

      // Template reorders: Footer moves before Body
      const toContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Footer', props: { id: 'footer-1' } },
        { type: 'Body', props: { id: 'body-1' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      // Body was removed by user, so it's skipped. Hero and Footer maintain template order.
      expect(content).toHaveLength(2);
      expect(content.map(c => c.props.id)).toEqual(['hero-1', 'footer-1']);
    });

    it('should be idempotent when doc already matches target order', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Heading', props: { id: 'h1' } },
          { type: 'Divider', props: { id: 'd1' } },
          { type: 'List', props: { id: 'list1' } },
          { type: 'Button', props: { id: 'b2' } },
        ],
      };

      const fromContent = [
        { type: 'Heading', props: { id: 'h1' } },
        { type: 'Divider', props: { id: 'd1' } },
        { type: 'Button', props: { id: 'b2' } },
        { type: 'List', props: { id: 'list1' } },
      ];

      const toContent = [
        { type: 'Heading', props: { id: 'h1' } },
        { type: 'Divider', props: { id: 'd1' } },
        { type: 'List', props: { id: 'list1' } },
        { type: 'Button', props: { id: 'b2' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      expect(content).toHaveLength(4);
      expect(content.map(c => c.props.id)).toEqual(['h1', 'd1', 'list1', 'b2']);
    });
  });

  // =========================================================================
  // processMigration: prop conflict detection
  // =========================================================================

  describe('processMigration: prop conflict detection', () => {
    it('should detect prop conflicts during migration when document has customized a template prop', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const {
        getLatestDocumentVersion,
        createDocumentVersion,
        reconstructVersionSnapshot,
      } = await import('../../src/services/document-version-service');

      const mockJob = createMockMigrationJob({ total_documents: 1 });

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockJob],
        rowCount: 1,
      });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta: no structural changes, prop-only
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // reconstructVersionSnapshot for extractTemplateDelta (fromVersion)
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce({
        content: [
          { type: 'Hero', props: { id: 'hero-1', title: 'Old Title' } },
        ],
        root: { props: {} },
        zones: {},
      });

      // reconstructVersionSnapshot for extractTemplateDelta (toVersion)
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce({
        content: [
          { type: 'Hero', props: { id: 'hero-1', title: 'New Title' } },
        ],
        root: { props: {} },
        zones: {},
      });

      // reconstructVersionSnapshot for templateContent (toVersion)
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce({
        content: [
          { type: 'Hero', props: { id: 'hero-1', title: 'New Title' } },
        ],
        root: { props: {} },
        zones: {},
      });

      // reconstructVersionSnapshot for fromTemplateSnapshot (fromVersion, for prop migration)
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce({
        content: [
          { type: 'Hero', props: { id: 'hero-1', title: 'Old Title' } },
        ],
        root: { props: {} },
        zones: {},
      });

      // findAffectedDocuments: document with customized title
      const docRow = {
        ...createMockDocument({ id: 'doc-custom', template_version: 1 }),
        snapshot: {
          content: [
            { type: 'Hero', props: { id: 'hero-1', title: 'My Custom Title' } },
          ],
          root: { props: {} },
          zones: {},
        },
      };
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [docRow],
        rowCount: 1,
      });

      // detectDocumentConflicts: no structural changes in doc
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // applyDeltaToDocument: getLatestDocumentVersion
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-300', documentId: 'doc-custom', branchId: 'branch-uuid-789',
        versionNumber: 2,
        snapshot: {
          content: [
            { type: 'Hero', props: { id: 'hero-1', title: 'My Custom Title' } },
          ],
          root: { props: {} },
          zones: {},
        },
        source: 'edit' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-301', documentId: 'doc-custom', branchId: 'branch-uuid-789',
        versionNumber: 3,
        snapshot: {
          content: [
            { type: 'Hero', props: { id: 'hero-1', title: 'My Custom Title' } },
          ],
        },
        source: 'migration' as DocumentVersionSource,
        createdById: 'user-uuid-001', createdByType: 'user',
        createdAt: '2026-06-18T10:01:00.000Z',
      });

      // UPDATE template_version for clean documents
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update progress
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // findAffectedDocuments: empty (done)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await processMigration('job-uuid-123');

      // Prop conflicts are resolved by three-way merge (not blocking)
      expect(result.conflictedDocuments).toBe(0);
      expect(result.processedDocuments).toBe(1);
    });
  });

  // =========================================================================
  // Guardrail tests
  // =========================================================================

  describe('guardrail tests', () => {
    it('snapshot_sync with empty toContent should remove all template components', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'hero-1' } },
          { type: 'UserWidget', props: { id: 'user-w' } },
          { type: 'Body', props: { id: 'body-1' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
      ];

      const toContent: Array<{ type: string; props: { id: string } }> = [];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      // Template components removed, user component preserved
      expect(content).toHaveLength(1);
      expect(content[0].props.id).toBe('user-w');
    });

    it('snapshot_sync with components that have no props.id should not crash', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'hero-1' } },
          { type: 'Spacer' },
          { type: 'Body', props: { id: 'body-1' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
      ];

      const toContent = [
        { type: 'Body', props: { id: 'body-1' } },
        { type: 'Hero', props: { id: 'hero-1' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props?: { id: string } }>;
      // Should not crash; Spacer (no ID) treated as document-specific
      expect(content.length).toBeGreaterThanOrEqual(2);
      const ids = content.map(c => c.props?.id).filter(Boolean);
      expect(ids[0]).toBe('body-1');
      expect(ids[1]).toBe('hero-1');
    });

    it('prop patch on component removed by snapshot_sync should not crash', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'hero-1', title: 'Hello' } },
          { type: 'OldWidget', props: { id: 'old-w', color: 'red' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'OldWidget', props: { id: 'old-w' } },
      ];

      // Template removes OldWidget
      const toContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
      ];

      // Prop patch targets the removed component
      const propMigration = {
        propPatches: [
          {
            componentId: 'old-w',
            operations: [{ op: 'replace' as const, path: '/color', value: 'blue' }],
          },
        ],
        fromTemplateContent: [
          { type: 'OldWidget', props: { id: 'old-w', color: 'red' } },
        ],
      };

      // Should not crash — the component is gone, so prop patch is silently skipped
      const result = applyDeltaToSnapshot(
        docSnapshot,
        [{ type: 'snapshot_sync', fromContent, toContent }],
        undefined,
        propMigration,
      );

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      expect(content).toHaveLength(1);
      expect(content[0].props.id).toBe('hero-1');
    });

    it('snapshot_sync should not duplicate components that exist in both document and toContent', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'hero-1', title: 'Custom' } },
          { type: 'Body', props: { id: 'body-1' } },
        ],
      };

      const fromContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
      ];

      const toContent = [
        { type: 'Hero', props: { id: 'hero-1' } },
        { type: 'Body', props: { id: 'body-1' } },
        { type: 'Footer', props: { id: 'footer-new' } },
      ];

      const result = applyDeltaToSnapshot(docSnapshot, [
        { type: 'snapshot_sync', fromContent, toContent },
      ]);

      const content = result.content as Array<{ type: string; props: { id: string } }>;
      // No duplicates — shared components appear once with doc's props
      expect(content).toHaveLength(3);
      const ids = content.map(c => c.props.id);
      expect(new Set(ids).size).toBe(3);
      expect(content[0].props.title).toBe('Custom');
    });
  });
});
