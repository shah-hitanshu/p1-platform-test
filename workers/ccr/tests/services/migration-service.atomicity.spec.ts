/**
 * Atomicity guarantees for template migration.
 *
 * Two invariants:
 * 1. A migrated document's template edge advances to the new synced_version in
 *    the same unit of work that applies its delta, so a mid-batch failure can
 *    never leave an applied document eligible for re-migration.
 * 2. Resolving a conflict is idempotent under concurrency: the conflict row is
 *    locked and an already-resolved conflict is never applied a second time.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  documentRelations,
  documents,
  migrationConflicts,
  migrationJobs,
} from '../../src/db/schema';
import { processMigration, resolveMigrationConflict } from '../../src/services/migration-service';
import { ConflictAlreadyResolvedError } from '../../src/services/errors';
import {
  createDocumentVersion,
  getLatestDocumentVersion,
  reconstructVersionSnapshot,
} from '../../src/services/document-version-service';

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
}));

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersion: vi.fn(),
  createDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn().mockResolvedValue({ content: [] }),
}));

vi.mock('@pantheon-systems/p1-content-validator', () => ({
  validateDocumentStructure: vi.fn().mockReturnValue({ errors: [] }),
}));

describe('Migration atomicity', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = stubDatabase();
  });

  const emptySnapshot = { content: [], root: { props: {} }, zones: {} };

  function migrationJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'job-1',
      site_id: 'site-1',
      branch_id: 'branch-1',
      template_id: 'template-1',
      from_version: 1,
      to_version: 2,
      checkpoint_id: 'checkpoint-1',
      status: 'pending',
      total_documents: 2,
      processed_documents: 0,
      created_by_id: 'user-1',
      created_by_type: 'user',
      created_at: '2026-07-01T00:00:00.000Z',
      completed_at: null,
      ...overrides,
    };
  }

  function conflictRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'conflict-1',
      migration_job_id: 'job-1',
      document_id: 'doc-1',
      branch_id: 'branch-1',
      template_id: 'template-1',
      from_version: 1,
      to_version: 2,
      template_delta: { added: [], removed: [], moved: [], templateIds: [] },
      document_actions: { added: [], removed: [], moved: [], templateIds: [] },
      prop_conflicts: [],
      conflict_type: 'structural',
      resolution: null,
      created_at: '2026-07-01T00:00:00.000Z',
      resolved_at: null,
      ...overrides,
    };
  }

  describe('processMigration', () => {
    it('advances synced_version per document rather than once per batch', async () => {

      // Template unchanged across versions => empty delta => both documents clean.
      vi.mocked(reconstructVersionSnapshot).mockResolvedValue(emptySnapshot);

      stub.on(migrationJobs).select.returnsRaw([migrationJob()]);
      // Claiming the job is what moves it out of pending; the returned id is
      // what says this run won the claim.
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-1' }]);
      stub.on(documents).select.returnsRaw([
        { id: 'doc-a', site_id: 'site-1', path: 'a', template_id: 'template-1', template_version: 1, snapshot: emptySnapshot },
        { id: 'doc-b', site_id: 'site-1', path: 'b', template_id: 'template-1', template_version: 1, snapshot: emptySnapshot },
      ]);
      // A migrated document stops matching the listing, which is what ends the
      // paging loop; the notification is the point at which that becomes true.
      const migrated = (): Promise<void> => {
        stub.on(documents).select.returnsRaw([]);
        return Promise.resolve();
      };

      vi.mocked(getLatestDocumentVersion).mockResolvedValue({
        id: 'v-1', documentId: 'doc-a', branchId: 'branch-1', versionNumber: 1,
        snapshot: emptySnapshot, source: 'edit', createdById: 'user-1', createdByType: 'user',
        createdAt: '2026-07-01T00:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValue({
        id: 'v-2', documentId: 'doc-a', branchId: 'branch-1', versionNumber: 2,
        snapshot: emptySnapshot, source: 'migration', createdById: 'user-1', createdByType: 'user',
        createdAt: '2026-07-01T00:01:00.000Z',
      });

      const result = await processMigration('job-1', migrated);
      expect(result.processedDocuments).toBe(2);
      expect(result.conflictedDocuments).toBe(0);

      const syncedCalls = stub.calls(documentRelations).update.filter(
        (call) => call.sql.includes('SET synced_version'),
      );

      // One advance per clean document, each scoped to a single document id
      // rather than a batched ANY(array) of ids.
      expect(syncedCalls.length).toBe(2);
      for (const call of syncedCalls) {
        expect(Array.isArray(call.params[1])).toBe(false);
      }
    });

    it('wraps each migrated document in a transaction', async () => {

      vi.mocked(reconstructVersionSnapshot).mockResolvedValue(emptySnapshot);

      stub.on(migrationJobs).select.returnsRaw([migrationJob({ total_documents: 1 })]);
      stub.on(migrationJobs).update.returnsRaw([{ id: 'job-1' }]);
      stub.on(documents).select.returnsRaw([
        { id: 'doc-a', site_id: 'site-1', path: 'a', template_id: 'template-1', template_version: 1, snapshot: emptySnapshot },
      ]);
      const migrated = (): Promise<void> => {
        stub.on(documents).select.returnsRaw([]);
        return Promise.resolve();
      };

      vi.mocked(getLatestDocumentVersion).mockResolvedValue({
        id: 'v-1', documentId: 'doc-a', branchId: 'branch-1', versionNumber: 1,
        snapshot: emptySnapshot, source: 'edit', createdById: 'user-1', createdByType: 'user',
        createdAt: '2026-07-01T00:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValue({
        id: 'v-2', documentId: 'doc-a', branchId: 'branch-1', versionNumber: 2,
        snapshot: emptySnapshot, source: 'migration', createdById: 'user-1', createdByType: 'user',
        createdAt: '2026-07-01T00:01:00.000Z',
      });

      await processMigration('job-1', migrated);

      expect(stub.transaction.committed).toBeGreaterThan(0);
    });
  });

  describe('resolveMigrationConflict', () => {
    it('does not re-apply a conflict that is already resolved', async () => {

      stub.on(migrationConflicts).select.returnsRaw([
        conflictRow({ resolution: 'apply', resolved_at: '2026-07-01T01:00:00.000Z' }),
      ]);
      // A snapshot is available, so an unguarded resolve would happily apply the
      // delta a second time and write a duplicate version.
      vi.mocked(getLatestDocumentVersion).mockResolvedValue({
        id: 'v-1', documentId: 'doc-1', branchId: 'branch-1', versionNumber: 3,
        snapshot: emptySnapshot, source: 'edit', createdById: 'user-1', createdByType: 'user',
        createdAt: '2026-07-01T00:00:00.000Z',
      });
      vi.mocked(createDocumentVersion).mockResolvedValue({
        id: 'v-2', documentId: 'doc-1', branchId: 'branch-1', versionNumber: 4,
        snapshot: emptySnapshot, source: 'migration', createdById: 'user-1', createdByType: 'user',
        createdAt: '2026-07-01T00:01:00.000Z',
      });

      const result = await resolveMigrationConflict('conflict-1', 'apply', { id: 'user-1', type: 'user' });

      expect(result.resolution).toBe('apply');
      expect(createDocumentVersion).not.toHaveBeenCalled();
    });

    it('rejects re-resolving a conflict with a different resolution', async () => {

      // Already settled as 'skip'; a follow-up 'apply' must not silently return
      // the stale record nor apply the delta on top of the prior outcome.
      stub.on(migrationConflicts).select.returnsRaw([
        conflictRow({ resolution: 'skip', resolved_at: '2026-07-01T01:00:00.000Z' }),
      ]);

      await expect(
        resolveMigrationConflict('conflict-1', 'apply', { id: 'user-1', type: 'user' }),
      ).rejects.toBeInstanceOf(ConflictAlreadyResolvedError);
      expect(createDocumentVersion).not.toHaveBeenCalled();
    });

    it('locks the conflict row for update before resolving', async () => {

      stub.on(migrationConflicts).select.returnsRaw([conflictRow()]);
      stub.on(migrationConflicts).update.returnsRaw([
        conflictRow({ resolution: 'skip', resolved_at: '2026-07-01T01:00:00.000Z' }),
      ]);

      await resolveMigrationConflict('conflict-1', 'skip', { id: 'user-1', type: 'user' });

      expect(stub.calls(migrationConflicts).select[0].sql).toContain('FOR UPDATE');
    });

    it('runs conflict resolution inside a transaction', async () => {

      stub.on(migrationConflicts).select.returnsRaw([conflictRow()]);
      stub.on(migrationConflicts).update.returnsRaw([
        conflictRow({ resolution: 'skip', resolved_at: '2026-07-01T01:00:00.000Z' }),
      ]);

      await resolveMigrationConflict('conflict-1', 'skip', { id: 'user-1', type: 'user' });

      expect(stub.transaction.committed).toBe(1);
    });
  });
});
