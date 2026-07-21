/**
 * Multi-version migration test (v1→v3)
 *
 * Exercises migrations that span more than one version step. With only v1→v2
 * tests, bugs where `currentVersion + 1` vs `toVersion` are confused would
 * be invisible. This test ensures extractTemplateDelta aggregates structural
 * actions across multiple version increments and that processMigration
 * applies them correctly to documents still on v1 when the template is at v3.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
}));

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersion: vi.fn(),
  createDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-content-validator', () => ({
  validateDocumentStructure: vi.fn(),
}));

describe('Multi-version migration (v1→v3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('extractTemplateDelta across multiple versions', () => {
    it('aggregates structural actions from v1→v2 and v2→v3 into a single delta', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      // Two structural versions: v2 added a reorder, v3 added an insert
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            action_metadata: {
              puckActions: [
                { type: 'reorder', sourceIndex: 0, destinationIndex: 2 },
              ],
            },
          },
          {
            action_metadata: {
              puckActions: [
                { type: 'insert', componentType: 'CTA', destinationIndex: 1 },
              ],
            },
          },
        ],
        rowCount: 2,
      });

      const v1Snap = {
        content: [
          { type: 'Hero', props: { id: 'h1' } },
          { type: 'Body', props: { id: 'b1' } },
          { type: 'Footer', props: { id: 'f1' } },
        ],
        root: { props: {} },
        zones: {},
      };
      const v3Snap = {
        content: [
          { type: 'Body', props: { id: 'b1' } },
          { type: 'CTA', props: { id: 'cta1', label: 'Click' } },
          { type: 'Footer', props: { id: 'f1' } },
          { type: 'Hero', props: { id: 'h1' } },
        ],
        root: { props: {} },
        zones: {},
      };

      vi.mocked(dvs.reconstructVersionSnapshot)
        .mockResolvedValueOnce(v1Snap)
        .mockResolvedValueOnce(v3Snap);

      const result = await extractTemplateDelta(
        'template-001',
        'branch-001',
        1,
        3,
      );

      expect(result.structuralActions).toHaveLength(2);
      expect(result.structuralActions[0].type).toBe('reorder');
      expect(result.structuralActions[1].type).toBe('insert');
    });

    it('queries version range (1, 3] not just (1, 2]', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const dvs = await import('../../src/services/document-version-service');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
      vi.mocked(dvs.reconstructVersionSnapshot)
        .mockResolvedValue({ content: [], root: { props: {} }, zones: {} });

      await extractTemplateDelta('template-001', 'branch-001', 1, 3);

      const callArgs = vi.mocked(db.query).mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const params = callArgs[1]!;
      // params should contain fromVersion=1 and toVersion=3
      expect(params).toContain(1);
      expect(params).toContain(3);
    });
  });

  describe('applyDeltaToSnapshot with compound delta', () => {
    it('applies reorder then insert in sequence (v1→v3 compound)', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1' } },
          { type: 'Body', props: { id: 'b1' } },
          { type: 'Footer', props: { id: 'f1' } },
        ],
      };

      const delta = [
        { type: 'reorder', sourceIndex: 0, destinationIndex: 2 },
        { type: 'insert', componentType: 'CTA', destinationIndex: 1 },
      ];

      const result = applyDeltaToSnapshot(snapshot, delta);

      const content = result.content as { type: string }[];
      // After reorder(0→2): [Body, Footer, Hero]
      // After insert CTA at 1: [Body, CTA, Footer, Hero]
      expect(content).toHaveLength(4);
      expect(content[0].type).toBe('Body');
      expect(content[1].type).toBe('CTA');
      expect(content[2].type).toBe('Footer');
      expect(content[3].type).toBe('Hero');
    });

    it('applies insert then delete across versions', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const snapshot = {
        content: [
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
        ],
      };

      // v2 inserted C at index 1, v3 deleted the old B (now at index 2)
      const delta = [
        { type: 'insert', componentType: 'C', destinationIndex: 1 },
        { type: 'delete', sourceIndex: 2 },
      ];

      const result = applyDeltaToSnapshot(snapshot, delta);

      const content = result.content as { type: string }[];
      // After insert C at 1: [A, C, B]
      // After delete at 2: [A, C]
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe('A');
      expect(content[1].type).toBe('C');
    });
  });

  describe('processMigration end-to-end v1→v3', () => {
    it('migrates a document from template v1 to v3 with compound delta', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const {
        getLatestDocumentVersion,
        createDocumentVersion,
        reconstructVersionSnapshot,
      } = await import('../../src/services/document-version-service');
      const { validateDocumentStructure } = await import('@pantheon-systems/p1-content-validator');

      const mockJob = {
        id: 'job-v1v3',
        site_id: 'site-001',
        branch_id: 'branch-001',
        template_id: 'template-001',
        from_version: 1,
        to_version: 3,
        checkpoint_id: 'chk-001',
        status: 'pending' as const,
        total_documents: 1,
        processed_documents: 0,
        created_by_id: 'user-001',
        created_by_type: 'user' as const,
        created_at: '2026-06-20T00:00:00Z',
        completed_at: null,
      };

      // getMigrationJob
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockJob], rowCount: 1 });

      // Update status to 'in_progress'
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // extractTemplateDelta: two structural versions spanning v1→v3
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            action_metadata: {
              puckActions: [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1 }],
            },
          },
          {
            action_metadata: {
              puckActions: [{ type: 'insert', componentType: 'Banner', destinationIndex: 0 }],
            },
          },
        ],
        rowCount: 2,
      });

      // reconstructVersionSnapshot for template v1 and v3 (prop patch extraction)
      const templateV1 = { content: [{ type: 'Hero' }, { type: 'Body' }], root: { props: {} }, zones: {} };
      const templateV3 = {
        content: [
          { type: 'Banner', props: { id: 'ban1', text: 'New!' } },
          { type: 'Body' },
          { type: 'Hero' },
        ],
        root: { props: {} },
        zones: {},
      };
      vi.mocked(reconstructVersionSnapshot)
        .mockResolvedValueOnce(templateV1)
        .mockResolvedValueOnce(templateV3);

      // reconstructVersionSnapshot for templateContent (toVersion snapshot)
      vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce(templateV3);

      // findAffectedDocuments: one doc on v1
      const docRow = {
        id: 'doc-001',
        site_id: 'site-001',
        branch_id: 'branch-001',
        path: 'pages/home',
        template_id: 'template-001',
        template_version: 1,
        snapshot: { content: [{ type: 'Hero', props: { title: 'Hi' } }, { type: 'Body', props: {} }], root: {}, zones: {} },
      };
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [docRow], rowCount: 1 });

      // detectDocumentConflicts: no structural changes in doc since v1
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ version_number: 0 }], rowCount: 1 });
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // applyDeltaToDocument flow
      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-100',
        documentId: 'doc-001',
        branchId: 'branch-001',
        versionNumber: 5,
        snapshot: { content: [{ type: 'Hero', props: { title: 'Hi' } }, { type: 'Body', props: {} }], root: {}, zones: {} },
        source: 'edit' as DocumentVersionSource,
        createdById: 'user-001',
        createdByType: 'user',
        createdAt: '2026-06-20T00:00:00Z',
      });

      vi.mocked(validateDocumentStructure).mockReturnValueOnce({ errors: [] });

      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-101',
        documentId: 'doc-001',
        branchId: 'branch-001',
        versionNumber: 6,
        snapshot: {
          content: [
            { type: 'Banner', props: { id: 'ban1', text: 'New!' } },
            { type: 'Body', props: {} },
            { type: 'Hero', props: { title: 'Hi' } },
          ],
          root: {},
          zones: {},
        },
        source: 'migration',
        createdById: 'user-001',
        createdByType: 'user',
        createdAt: '2026-06-20T00:01:00Z',
      });

      // Update documents.template_version to v3
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // Update progress
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // findAffectedDocuments: second batch empty
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Mark completed
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await processMigration('job-v1v3');

      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(0);

      // createDocumentVersion should have been called with migration source
      expect(createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'migration',
          documentId: 'doc-001',
        }),
      );

      // The synced_version batch update should reference toVersion=3
      const updateCalls = vi.mocked(db.query).mock.calls.filter(
        (call) => {
          const sql = (call[0]).toUpperCase();
          return sql.includes('UPDATE') && sql.includes('SYNCED_VERSION') && sql.includes('DOCUMENT_RELATIONS');
        },
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
