/**
 * Phase 3.3: Checkpoint Service Tests (TDD)
 *
 * Tests for Checkpoint CRUD operations, document capture, and revert functionality.
 * Checkpoints are named snapshots of branch state at a point in time.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckpointType } from '../../src/types';
import { checkpointDocuments, checkpoints, documentVersions } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

/**
 * The capture query reads from a derived table, so it is keyed by that name:
 * no schema table describes what it selects.
 */
const CAPTURE = 'latest';

describe('Phase 3.3: Checkpoint Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
  });

  /** The checkpoint INSERT returns *, so its row is in column names. */
  function insertedCheckpointRow(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'checkpoint-uuid-123',
      branch_id: 'branch-uuid-789',
      name: 'v1.0',
      message: 'First release checkpoint',
      checkpoint_type: 'manual',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-01-23T10:00:00.000Z',
      is_full_snapshot: true,
      ...overrides,
    };
  }

  /** A checkpoint read through the query builder, in the schema's property names. */
  function checkpointRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'checkpoint-uuid-123',
      branchId: 'branch-uuid-789',
      name: 'v1.0',
      message: 'First release checkpoint',
      checkpointType: 'manual',
      createdById: 'user-uuid-001',
      createdByType: 'user',
      createdAt: new Date('2026-01-23T10:00:00.000Z'),
      isFullSnapshot: true,
      ...overrides,
    };
  }

  /** One entry of a capture query's result, in the names the statement gives them. */
  function manifestRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      document_id: 'doc-uuid-456',
      document_version_id: 'version-uuid-789',
      ...overrides,
    };
  }

  /** A checkpoint document read through the query builder. */
  function documentVersionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'version-uuid-789',
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      versionNumber: 1,
      snapshot: { title: 'Test Document', content: [] },
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
      createdAt: new Date('2026-01-23T09:00:00.000Z'),
      documentPath: 'pages/home',
      ...overrides,
    };
  }

  /** A document the chain walk resolves, in the names the raw statement gives them. */
  function resolvedDocumentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'version-uuid-789',
      document_id: 'doc-uuid-456',
      branch_id: 'branch-uuid-789',
      version_number: 1,
      snapshot: { title: 'Test Document', content: [] },
      source: 'edit',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-01-23T09:00:00.000Z',
      document_path: 'pages/home',
      ...overrides,
    };
  }

  describe('createCheckpoint', () => {
    it('should create a checkpoint capturing current branch state', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).insert.returnsRaw([insertedCheckpointRow()]);
      database.on(CAPTURE).select.returnsRaw([
        manifestRow({ document_id: 'doc-1', document_version_id: 'v-1' }),
        manifestRow({ document_id: 'doc-2', document_version_id: 'v-2' }),
      ]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        name: 'v1.0',
        message: 'First release checkpoint',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.checkpoint.id).toBe('checkpoint-uuid-123');
      expect(result.checkpoint.branchId).toBe('branch-uuid-789');
      expect(result.checkpoint.name).toBe('v1.0');
      expect(result.checkpoint.message).toBe('First release checkpoint');
      expect(result.checkpoint.checkpointType).toBe('manual');
      expect(result.documentCount).toBe(2);
    });

    it('records whether the capture was a full snapshot or a delta', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      // Forced full sweep despite having a parent — what session pre-edit does.
      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({ parent_checkpoint_id: 'parent-checkpoint' }),
      ]);

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'session_pre_edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        forceFullSnapshot: true,
      });

      expect(insertedSnapshotFlags(database)).toEqual({ explicitList: false, forcedFull: true });

      // An explicit document list is a delta whatever the parent says.
      database = stubDatabase();
      database.on(checkpoints).insert.returnsRaw([insertedCheckpointRow()]);

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'publish',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        documentVersionIds: [{ documentId: 'doc-1', documentVersionId: 'v-1' }],
      });

      expect(insertedSnapshotFlags(database)).toEqual({ explicitList: true, forcedFull: false });
    });

    it('chunks the manifest INSERT so a large branch stays under the bind-parameter cap', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).insert.returnsRaw([insertedCheckpointRow()]);
      database.on(CAPTURE).select.returnsRaw(
        Array.from({ length: 10_001 }, (_, i) =>
          manifestRow({ document_id: `doc-${String(i)}`, document_version_id: `v-${String(i)}` }),
        ),
      );

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      const manifestInserts = database.calls(checkpointDocuments).insert;

      expect(manifestInserts).toHaveLength(2);
      for (const insert of manifestInserts) {
        expect(insert.params.length).toBeLessThan(65_535);
      }
      expect(result.documentCount).toBe(10_001);
    });

    it('should create a checkpoint with optional name and message', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({ name: null, message: null }),
      ]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'auto',
        createdById: 'system',
        createdByType: 'system',
      });

      expect(result.checkpoint.name).toBeUndefined();
      expect(result.checkpoint.message).toBeUndefined();
    });

    it('should support different checkpoint types', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      const types: CheckpointType[] = ['manual', 'auto', 'pre_merge', 'post_merge'];

      for (const checkpointType of types) {
        database = stubDatabase();
        database.on(checkpoints).insert.returnsRaw([
          insertedCheckpointRow({ checkpoint_type: checkpointType }),
        ]);

        const result = await createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType,
          createdById: 'user-uuid-001',
          createdByType: 'user',
        });

        expect(result.checkpoint.checkpointType).toBe(checkpointType);
      }
    });

    it('should create checkpoint with zero documents when branch is empty', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).insert.returnsRaw([insertedCheckpointRow()]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentCount).toBe(0);
    });

    it('should throw BranchNotFoundError when branch does not exist', async () => {
      const { createCheckpoint, BranchNotFoundError } = await import('../../src/services/checkpoint-service');

      const error = new Error('violates foreign key constraint');
      (error as NodeJS.ErrnoException).code = '23503';
      database.on(checkpoints).insert.rejects(error);

      await expect(
        createCheckpoint({
          branchId: 'nonexistent-branch',
          checkpointType: 'manual',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(BranchNotFoundError);
    });

    it('should throw InvalidCheckpointParamsError when branchId is empty', async () => {
      const { createCheckpoint, InvalidCheckpointParamsError } = await import('../../src/services/checkpoint-service');

      await expect(
        createCheckpoint({
          branchId: '',
          checkpointType: 'manual',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidCheckpointParamsError);
    });

    it('should throw InvalidCheckpointParamsError when createdById is empty', async () => {
      const { createCheckpoint, InvalidCheckpointParamsError } = await import('../../src/services/checkpoint-service');

      await expect(
        createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType: 'manual',
          createdById: '',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidCheckpointParamsError);
    });

    it('should exclude tombstoned documents from checkpoint', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).insert.returnsRaw([insertedCheckpointRow()]);
      database.on(CAPTURE).select.returnsRaw([
        manifestRow({ document_id: 'doc-live', document_version_id: 'v-live' }),
      ]);

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      const [capture] = database.calls(CAPTURE).select;
      expect(capture.sql).toContain('DISTINCT ON');
      expect(capture.sql).toContain('is_tombstone');
    });

    // PCC-3430: root cause of the p1-teamworks stale-registry-descriptor bug.
    // agent_pre_edit checkpoints (forceFullSnapshot: true) previously swept in
    // the latest version of every document on the branch, including
    // _registry/components/* and _registry/index — sync-owned metadata, not
    // user-editable content. If such a checkpoint is later rolled back
    // (orphaned agent session cleanup), the registry document is silently
    // reverted to its checkpoint-time content, desyncing it from whatever the
    // registry index believes is the latest hash — the index is never told
    // about this out-of-band revert. syncComponentRegistry's fast path then
    // trusts the (now-wrong) index forever, exactly matching the reported
    // symptom (same descriptor frozen at the same registeredAt across every
    // subsequent sync). _registry/* must never be captured by, or revertible
    // via, an agent edit-session checkpoint.
    it('PCC-3430: excludes _registry/* documents from the full-snapshot capture query', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({ checkpoint_type: 'agent_pre_edit' }),
      ]);
      database.on(CAPTURE).select.returnsRaw([
        manifestRow({ document_id: 'doc-page', document_version_id: 'v-page' }),
      ]);

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'agent_pre_edit',
        createdById: 'agent-001',
        createdByType: 'agent',
        forceFullSnapshot: true,
      });

      const [capture] = database.calls(CAPTURE).select;
      expect(capture.sql).toContain('DISTINCT ON');
      // Must join documents to filter by path, and must exclude _registry/*
      // via an escaped, parameterized pattern — not an inlined literal, since
      // '_' is a LIKE wildcard (matches any single character) and an inlined
      // '_registry/%' would also match e.g. 'xregistry/...'.
      expect(capture.sql).toMatch(/join\s+app\.documents/i);
      expect(capture.sql).toMatch(/not\s+like\s+\$\d+\s+escape/i);
      expect(capture.params).toContain('\\_registry/%');
      // The templates exception (isSystemManagedPath's own exclusion) must
      // still be captured/revertible normally.
      expect(capture.sql).toMatch(/like\s+\$\d+\s+escape/i);
      expect(capture.params).toContain('\\_registry/templates/%');
    });

    it('PCC-3430: excludes _registry/* documents from the incremental capture query', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      // A parent and no forceFullSnapshot takes the incremental branch.
      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({
          checkpoint_type: 'auto',
          parent_checkpoint_id: 'parent-checkpoint-1',
        }),
      ]);

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'auto',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      const [capture] = database.calls(CAPTURE).select;
      expect(capture.sql).toContain('WITH RECURSIVE chain');
      expect(capture.sql).toContain('DISTINCT ON');
      expect(capture.sql).toMatch(/join\s+app\.documents/i);
      expect(capture.sql).toMatch(/not\s+like\s+\$\d+\s+escape/i);
      expect(capture.params).toContain('\\_registry/%');
      expect(capture.sql).toMatch(/like\s+\$\d+\s+escape/i);
      expect(capture.params).toContain('\\_registry/templates/%');
    });

    it('PCC-3430: does not exclude _registry/templates/* — those are user-authored content types, not sync-owned metadata', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({ checkpoint_type: 'agent_pre_edit' }),
      ]);
      database.on(CAPTURE).select.returnsRaw([
        manifestRow({ document_id: 'doc-template', document_version_id: 'v-template' }),
      ]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'agent_pre_edit',
        createdById: 'agent-001',
        createdByType: 'agent',
        forceFullSnapshot: true,
      });

      // The stubbed capture returned one row (the template), so it must be
      // reflected in the checkpoint's document count — the WHERE clause's
      // templates exception must not be structured in a way that a real
      // Postgres server would reject or that this test's stub bypasses.
      expect(result.documentCount).toBe(1);

      // The exception must be expressed as "excluded UNLESS templates" (an
      // OR against a LIKE, not just a second unconditional exclusion) —
      // guards against a future edit collapsing this into a plain AND that
      // would exclude templates again.
      const [capture] = database.calls(CAPTURE).select;
      expect(capture.sql).toMatch(/not\s+like\s+\$\d+\s+escape\s+'\\\\?'\s+or\s+d\.path\s+like\s+\$\d+\s+escape/i);
    });
  });

  describe('getCheckpoint', () => {
    it('should return a checkpoint by ID', async () => {
      const { getCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([checkpointRow()]);

      const result = await getCheckpoint('checkpoint-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('checkpoint-uuid-123');
      expect(result?.branchId).toBe('branch-uuid-789');
      expect(result?.name).toBe('v1.0');
      expect(result?.checkpointType).toBe('manual');
    });

    it('should return null when checkpoint does not exist', async () => {
      const { getCheckpoint } = await import('../../src/services/checkpoint-service');

      const result = await getCheckpoint('nonexistent-checkpoint');

      expect(result).toBeNull();
    });

    it('should handle checkpoint without name or message', async () => {
      const { getCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([checkpointRow({ name: null, message: null })]);

      const result = await getCheckpoint('checkpoint-uuid-123');

      expect(result?.name).toBeUndefined();
      expect(result?.message).toBeUndefined();
    });
  });

  describe('listCheckpoints', () => {
    it('should list checkpoints for a branch in descending order by creation time', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([
        checkpointRow({ id: 'cp-3', createdAt: new Date('2026-01-23T12:00:00.000Z') }),
        checkpointRow({ id: 'cp-2', createdAt: new Date('2026-01-23T11:00:00.000Z') }),
        checkpointRow({ id: 'cp-1', createdAt: new Date('2026-01-23T10:00:00.000Z') }),
      ]);

      const result = await listCheckpoints('branch-uuid-789');

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('cp-3');
      expect(result[1].id).toBe('cp-2');
      expect(result[2].id).toBe('cp-1');
      expect(database.calls(checkpoints).select[0].sql).toContain('order by');
    });

    it('should support pagination with limit', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([
        checkpointRow({ id: 'cp-3' }),
        checkpointRow({ id: 'cp-2' }),
      ]);

      const result = await listCheckpoints('branch-uuid-789', { limit: 2 });

      expect(result).toHaveLength(2);
      expect(database.calls(checkpoints).select[0].params).toContain(2);
    });

    it('should support pagination with offset', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([checkpointRow({ id: 'cp-1' })]);

      const result = await listCheckpoints('branch-uuid-789', { limit: 1, offset: 2 });

      expect(result).toHaveLength(1);
      expect(database.calls(checkpoints).select[0].sql).toContain('offset');
    });

    it('should filter by checkpoint type', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([checkpointRow({ checkpointType: 'manual' })]);

      const result = await listCheckpoints('branch-uuid-789', { checkpointType: 'manual' });

      expect(result).toHaveLength(1);
      expect(database.calls(checkpoints).select[0].params)
        .toEqual(expect.arrayContaining(['branch-uuid-789', 'manual']));
    });

    it('should return empty array when no checkpoints exist', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');

      const result = await listCheckpoints('branch-uuid-789');

      expect(result).toEqual([]);
    });
  });

  describe('getDocumentsAtCheckpoint', () => {
    it('should return all document versions captured in a checkpoint', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpointDocuments).select.returnsRaw([
        documentVersionRow({ documentId: 'doc-1', documentPath: 'pages/home' }),
        documentVersionRow({ documentId: 'doc-2', documentPath: 'pages/about' }),
        documentVersionRow({ documentId: 'doc-3', documentPath: 'components/header' }),
      ]);

      const result = await getDocumentsAtCheckpoint('checkpoint-uuid-123');

      expect(result).toHaveLength(3);
      expect(result[0].documentPath).toBe('pages/home');
      expect(result[1].documentPath).toBe('pages/about');
      expect(result[2].documentPath).toBe('components/header');
    });

    it('should return empty array for checkpoint with no documents', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');

      const result = await getDocumentsAtCheckpoint('checkpoint-uuid-123');

      expect(result).toEqual([]);
    });

    it('should include document version details', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpointDocuments).select.returnsRaw([
        documentVersionRow({
          versionNumber: 5,
          snapshot: { title: 'Home Page', components: [] },
        }),
      ]);

      const result = await getDocumentsAtCheckpoint('checkpoint-uuid-123');

      expect(result[0].versionNumber).toBe(5);
      expect(result[0].snapshot).toEqual({ title: 'Home Page', components: [] });
    });

    it('should include versionId matching the version id', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpointDocuments).select.returnsRaw([
        documentVersionRow({ id: 'version-uuid-specific' }),
      ]);

      const result = await getDocumentsAtCheckpoint('checkpoint-uuid-123');

      expect(result[0].versionId).toBe('version-uuid-specific');
      expect(result[0].id).toBe('version-uuid-specific');
    });
  });

  describe('getDocumentAtCheckpoint', () => {
    it('should return a specific document version at a checkpoint by path', async () => {
      const { getDocumentAtCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpointDocuments).select.returnsRaw([
        documentVersionRow({ documentPath: 'pages/home' }),
      ]);

      const result = await getDocumentAtCheckpoint('checkpoint-uuid-123', 'pages/home');

      expect(result).toBeDefined();
      expect(result?.documentPath).toBe('pages/home');
    });

    it('should return null when document path not found in checkpoint', async () => {
      const { getDocumentAtCheckpoint } = await import('../../src/services/checkpoint-service');

      const result = await getDocumentAtCheckpoint('checkpoint-uuid-123', 'nonexistent/path');

      expect(result).toBeNull();
    });
  });

  describe('revertToCheckpoint', () => {
    it('should create new document versions with source=revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([checkpointRow()]);
      database.on(documentVersions).select.returnsRaw([
        resolvedDocumentRow({ document_id: 'doc-1', document_path: 'pages/home' }),
        resolvedDocumentRow({ document_id: 'doc-2', document_path: 'pages/about' }),
      ]);
      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({
          id: 'new-checkpoint-after-revert',
          message: 'Reverted to checkpoint: checkpoint-uuid-123',
        }),
      ]);

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.checkpoint.message).toContain('Reverted to checkpoint');
      expect(result.documentsReverted).toBe(2);
    });

    it('resolves the parent chain rather than one manifest, so an incremental checkpoint restores the full document set', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      // Three documents takes the batch INSERT path (threshold is 3).
      database.on(checkpoints).select.returnsRaw([
        checkpointRow({ parentCheckpointId: 'parent-checkpoint' }),
      ]);
      database.on(documentVersions).select.returnsRaw([
        resolvedDocumentRow({ id: 'version-1', document_id: 'doc-1', document_path: 'pages/about' }),
        resolvedDocumentRow({ id: 'version-2', document_id: 'doc-2', document_path: 'pages/contact' }),
        resolvedDocumentRow({ id: 'version-3', document_id: 'doc-3', document_path: 'pages/home' }),
      ]);
      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({ id: 'revert-checkpoint' }),
      ]);

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // The document set comes from a chain walk that stops at the nearest
      // full snapshot, not from this checkpoint's own manifest.
      const [resolve] = database.calls(documentVersions).select;
      expect(resolve.sql).toContain('WITH RECURSIVE chain');
      expect(resolve.sql).toContain('chain.is_full_snapshot = false');

      // The batch INSERT is driven by the resolved ids, so it cannot fall back
      // to a single manifest's rows.
      const [revertInsert] = database.calls(documentVersions).insert;
      expect(revertInsert.sql).not.toContain('cd.checkpoint_id');
      expect(revertInsert.params).toEqual(
        expect.arrayContaining([
          ['doc-1', 'doc-2', 'doc-3'],
          ['version-1', 'version-2', 'version-3'],
        ]),
      );
      expect(result.documentsReverted).toBe(3);
    });

    it('should throw CheckpointNotFoundError when checkpoint does not exist', async () => {
      const { revertToCheckpoint, CheckpointNotFoundError } = await import('../../src/services/checkpoint-service');

      await expect(
        revertToCheckpoint({
          checkpointId: 'nonexistent-checkpoint',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(CheckpointNotFoundError);
    });

    it('should create a checkpoint documenting the revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([checkpointRow({ name: 'v1.0' })]);
      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({
          id: 'revert-checkpoint',
          message: 'Reverted to checkpoint: v1.0 (checkpoint-uuid-123)',
        }),
      ]);

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint.id).toBe('revert-checkpoint');
    });

    it('should handle revert with custom message', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([checkpointRow()]);
      database.on(checkpoints).insert.returnsRaw([
        insertedCheckpointRow({
          id: 'revert-checkpoint',
          message: 'Rolling back due to production issue',
        }),
      ]);

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        message: 'Rolling back due to production issue',
      });

      expect(result.checkpoint.message).toBe('Rolling back due to production issue');
    });
  });

  describe('deleteCheckpoint', () => {
    it('should delete a checkpoint and its document associations', async () => {
      const { deleteCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).delete.returnsRaw([{ id: 'checkpoint-uuid-123' }]);

      const result = await deleteCheckpoint('checkpoint-uuid-123');

      expect(result).toBe(true);
      // The manifest rows reference the checkpoint, so they go first.
      expect(database.calls(checkpointDocuments).delete).toHaveLength(1);
    });

    it('should return false when checkpoint does not exist', async () => {
      const { deleteCheckpoint } = await import('../../src/services/checkpoint-service');

      const result = await deleteCheckpoint('nonexistent-checkpoint');

      expect(result).toBe(false);
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should return the most recent checkpoint for a branch', async () => {
      const { getLatestCheckpoint } = await import('../../src/services/checkpoint-service');

      database.on(checkpoints).select.returnsRaw([
        checkpointRow({
          id: 'latest-checkpoint',
          createdAt: new Date('2026-01-23T15:00:00.000Z'),
        }),
      ]);

      const result = await getLatestCheckpoint('branch-uuid-789');

      expect(result).toBeDefined();
      expect(result?.id).toBe('latest-checkpoint');
    });

    it('should return null when branch has no checkpoints', async () => {
      const { getLatestCheckpoint } = await import('../../src/services/checkpoint-service');

      const result = await getLatestCheckpoint('branch-uuid-789');

      expect(result).toBeNull();
    });
  });

  describe('getCheckpointDocumentCount', () => {
    it('should return the count of documents in a checkpoint', async () => {
      const { getCheckpointDocumentCount } = await import('../../src/services/checkpoint-service');

      database.on(checkpointDocuments).select.returnsRaw([{ count: 5 }]);

      const result = await getCheckpointDocumentCount('checkpoint-uuid-123');

      expect(result).toBe(5);
    });

    it('should return 0 for checkpoint with no documents', async () => {
      const { getCheckpointDocumentCount } = await import('../../src/services/checkpoint-service');

      database.on(checkpointDocuments).select.returnsRaw([{ count: 0 }]);

      const result = await getCheckpointDocumentCount('checkpoint-uuid-123');

      expect(result).toBe(0);
    });
  });
});

/**
 * The two booleans the checkpoint INSERT binds to decide whether the capture is
 * a full snapshot: an explicit document list is always a delta, and a forced
 * full snapshot overrides the parent chain. They are bound by position, so the
 * positions are read once here.
 */
function insertedSnapshotFlags(database: DatabaseStub): {
  explicitList: unknown;
  forcedFull: unknown;
} {
  const [insert] = database.calls(checkpoints).insert;
  return { explicitList: insert.params[14], forcedFull: insert.params[15] };
}
