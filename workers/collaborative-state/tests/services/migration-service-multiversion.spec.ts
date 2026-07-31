/**
 * Multi-version migration test (v1→v3)
 *
 * Exercises migrations that span more than one version step. The delta between
 * two template versions is the id-keyed diff of their endpoint snapshots, so a
 * v1→v3 migration is the diff of the v1 and v3 snapshots regardless of how many
 * intermediate edits occurred. These tests guard the compound cases (add plus
 * reorder, add plus remove) and that processMigration applies a v1→v3 delta to
 * a document still bound to v1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';
import { buildSlotDelta } from '../../src/services/slot-delta';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
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
    it('derives the v1→v3 delta from the endpoint snapshots', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const dvs = await import('../../src/services/document-version-service');

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

      const result = await extractTemplateDelta('template-001', 'branch-001', 1, 3);

      // CTA is added; Hero relocates to the tail while Body and Footer hold order.
      expect(result.slotDelta.added).toHaveLength(1);
      expect(result.slotDelta.added[0].component.props.id).toBe('cta1');
      expect(result.slotDelta.moved.map((m) => m.id)).toEqual(['h1']);
      expect(result.slotDelta.removed).toEqual([]);
    });

    it('reconstructs the from and to endpoints, not intermediate versions', async () => {
      const { extractTemplateDelta } = await import('../../src/services/migration-service');
      const dvs = await import('../../src/services/document-version-service');

      vi.mocked(dvs.reconstructVersionSnapshot)
        .mockResolvedValue({ content: [], root: { props: {} }, zones: {} });

      await extractTemplateDelta('template-001', 'branch-001', 1, 3);

      expect(dvs.reconstructVersionSnapshot).toHaveBeenCalledWith('template-001', 'branch-001', 1);
      expect(dvs.reconstructVersionSnapshot).toHaveBeenCalledWith('template-001', 'branch-001', 3);
    });
  });

  describe('applyDeltaToSnapshot with a compound delta', () => {
    it('adds and reorders in a single v1→v3 delta', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const v1 = {
        content: [
          { type: 'Hero', props: { id: 'h1' } },
          { type: 'Body', props: { id: 'b1' } },
          { type: 'Footer', props: { id: 'f1' } },
        ],
        root: { props: {} },
        zones: {},
      };
      const v3 = {
        content: [
          { type: 'Body', props: { id: 'b1' } },
          { type: 'CTA', props: { id: 'cta1', label: 'Click' } },
          { type: 'Footer', props: { id: 'f1' } },
          { type: 'Hero', props: { id: 'h1' } },
        ],
        root: { props: {} },
        zones: {},
      };

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1' } },
          { type: 'Body', props: { id: 'b1' } },
          { type: 'Footer', props: { id: 'f1' } },
        ],
        root: { props: {} },
        zones: {},
      };

      const result = applyDeltaToSnapshot(docSnapshot, buildSlotDelta(v1, v3));

      const content = result.content as { type: string; props: { id: string; label?: string } }[];
      expect(content.map((c) => c.props.id)).toEqual(['b1', 'cta1', 'f1', 'h1']);
      expect(content[1].props.label).toBe('Click');
    });

    it('adds and removes across versions', async () => {
      const { applyDeltaToSnapshot } = await import('../../src/services/migration-service');

      const v1 = {
        content: [
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
        ],
        root: { props: {} },
        zones: {},
      };
      const v3 = {
        content: [
          { type: 'A', props: { id: 'a1' } },
          { type: 'C', props: { id: 'c1', value: 'new' } },
        ],
        root: { props: {} },
        zones: {},
      };

      const docSnapshot = {
        content: [
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
        ],
        root: { props: {} },
        zones: {},
      };

      const result = applyDeltaToSnapshot(docSnapshot, buildSlotDelta(v1, v3));

      const content = result.content as { type: string; props: { id: string } }[];
      expect(content.map((c) => c.props.id)).toEqual(['a1', 'c1']);
    });
  });

  describe('processMigration end-to-end v1→v3', () => {
    it('migrates a v1-bound document with a compound v1→v3 delta', async () => {
      const { processMigration } = await import('../../src/services/migration-service');
      const db = await import('../../src/db');
      const {
        getLatestDocumentVersion,
        createDocumentVersion,
        reconstructVersionSnapshot,
      } = await import('../../src/services/document-version-service');

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

      const docSnapshot = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Hi' } },
          { type: 'Body', props: { id: 'b1' } },
          { type: 'Old', props: { id: 'o1' } },
        ],
        root: { props: {} },
        zones: {},
      };

      let docsServed = false;
      vi.mocked(db.query).mockImplementation((sql: string) => {
        if (sql.startsWith('SELECT') && sql.includes('app.migration_jobs')) {
          return Promise.resolve({ rows: [mockJob], rowCount: 1 });
        }
        if (sql.includes('FROM app.documents')) {
          if (docsServed) return Promise.resolve({ rows: [], rowCount: 0 });
          docsServed = true;
          return Promise.resolve({
            rows: [{
              id: 'doc-001', site_id: 'site-001', path: 'pages/home',
              template_id: 'template-001', template_version: 1, snapshot: docSnapshot,
            }],
            rowCount: 1,
          });
        }
        if (sql.includes("source = 'migration'")) {
          return Promise.resolve({ rows: [{ version_number: 5 }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });

      // v1→v3 removes Old and adds New; the document is untouched since baseline.
      vi.mocked(reconstructVersionSnapshot).mockImplementation((id: string, _branch: string, version: number) => {
        if (id === 'template-001') {
          return Promise.resolve(version === 1
            ? { content: [{ type: 'Hero', props: { id: 'h1', title: 'Hi' } }, { type: 'Body', props: { id: 'b1' } }, { type: 'Old', props: { id: 'o1' } }], root: { props: {} }, zones: {} }
            : { content: [{ type: 'Hero', props: { id: 'h1', title: 'Hi' } }, { type: 'Body', props: { id: 'b1' } }, { type: 'New', props: { id: 'n1', text: 'New!' } }], root: { props: {} }, zones: {} });
        }
        return Promise.resolve(docSnapshot);
      });

      vi.mocked(getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'v-100', documentId: 'doc-001', branchId: 'branch-001', versionNumber: 5,
        snapshot: docSnapshot, source: 'edit' as DocumentVersionSource,
        createdById: 'user-001', createdByType: 'user', createdAt: '2026-06-20T00:00:00Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValueOnce({
        id: 'v-101', documentId: 'doc-001', branchId: 'branch-001', versionNumber: 6,
        snapshot: docSnapshot, source: 'migration',
        createdById: 'user-001', createdByType: 'user', createdAt: '2026-06-20T00:01:00Z',
      });

      const result = await processMigration('job-v1v3');

      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(0);

      const persisted = vi.mocked(createDocumentVersion).mock.calls[0][0];
      expect(persisted.source).toBe('migration');
      const content = (persisted.snapshot as { content: { props: { id: string } }[] }).content;
      expect(content.map((c) => c.props.id)).toEqual(['h1', 'b1', 'n1']);

      const syncedVersionUpdates = vi.mocked(db.query).mock.calls.filter((call) => {
        const sql = (call[0]).toUpperCase();
        return sql.includes('UPDATE') && sql.includes('SYNCED_VERSION') && sql.includes('DOCUMENT_RELATIONS');
      });
      expect(syncedVersionUpdates.length).toBeGreaterThanOrEqual(1);
      expect(syncedVersionUpdates[0][1]).toContain(3);
    });
  });
});
