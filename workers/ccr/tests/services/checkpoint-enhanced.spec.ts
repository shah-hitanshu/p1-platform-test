/**
 * Agent Politeness System - Phase 3: Enhanced Checkpoint Service Tests (TDD)
 *
 * Tests for enhanced checkpoint functionality supporting agent auditability.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  CheckpointType,
  CheckpointTrigger,
  CheckpointStatus,
} from '../../src/types';
import { checkpoints } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

describe('Agent Politeness Phase 3: Enhanced Checkpoint Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
  });

  // Enhanced mock checkpoint row type with agent politeness fields
  // A type alias rather than an interface: the stub takes Record<string,
  // unknown>, which an interface cannot satisfy — it carries no index signature.
  type MockEnhancedCheckpointRow = {
    id: string;
    branch_id: string;
    name: string | null;
    message: string | null;
    description: string | null;
    checkpoint_type: CheckpointType;
    trigger: CheckpointTrigger;
    requested_by_id: string | null;
    operation_type: string | null;
    affected_regions: string[];
    status: CheckpointStatus;
    rolled_back_by_id: string | null;
    rolled_back_at: string | null;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
  };

  /** A checkpoint read through the query builder, in the schema's property names. */
  function checkpointRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const row = insertedCheckpointRow();
    return {
      id: row.id,
      branchId: row.branch_id,
      name: row.name,
      message: row.message,
      description: row.description,
      checkpointType: row.checkpoint_type,
      trigger: row.trigger,
      requestedById: row.requested_by_id,
      operationType: row.operation_type,
      affectedRegions: row.affected_regions,
      status: row.status,
      rolledBackById: row.rolled_back_by_id,
      rolledBackAt: null,
      createdById: row.created_by_id,
      createdByType: row.created_by_type,
      createdAt: new Date(row.created_at),
      parentCheckpointId: null,
      isFullSnapshot: true,
      ...overrides,
    };
  }

  /** The checkpoint INSERT returns *, so its row is in column names. */
  function insertedCheckpointRow(
    overrides: Partial<MockEnhancedCheckpointRow> = {},
  ): MockEnhancedCheckpointRow {
    return {
      id: 'checkpoint-uuid-123',
      branch_id: 'branch-uuid-789',
      name: 'Agent checkpoint',
      message: 'Checkpoint created by agent',
      description: 'Content optimization performed',
      checkpoint_type: 'manual',
      trigger: 'autonomous',
      requested_by_id: null,
      operation_type: 'content_optimization',
      affected_regions: ['/content/0', '/content/1'],
      status: 'completed',
      rolled_back_by_id: null,
      rolled_back_at: null,
      created_by_id: 'agent-uuid-001',
      created_by_type: 'agent',
      created_at: '2026-01-26T10:00:00.000Z',
      ...overrides,
    };
  }

  describe('createCheckpoint with enhanced fields', () => {
    it('should accept description field', async () => {
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = insertedCheckpointRow({
        description: 'Detailed description of changes',
      });

      database.on(checkpoints).insert.returnsRaw([mockRow]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'agent-uuid-001',
        createdByType: 'agent',
        description: 'Detailed description of changes',
      });

      expect(result.checkpoint.description).toBe('Detailed description of changes');
    });

    it('should accept trigger field', async () => {
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = insertedCheckpointRow({
        trigger: 'human_requested',
      });

      database.on(checkpoints).insert.returnsRaw([mockRow]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'agent-uuid-001',
        createdByType: 'agent',
        trigger: 'human_requested',
      });

      expect(result.checkpoint.trigger).toBe('human_requested');
    });

    it('should accept requestedById field', async () => {
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = insertedCheckpointRow({
        trigger: 'human_requested',
        requested_by_id: 'user-uuid-123',
      });

      database.on(checkpoints).insert.returnsRaw([mockRow]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'agent-uuid-001',
        createdByType: 'agent',
        trigger: 'human_requested',
        requestedById: 'user-uuid-123',
      });

      expect(result.checkpoint.requestedById).toBe('user-uuid-123');
    });

    it('should accept operationType field', async () => {
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = insertedCheckpointRow({
        operation_type: 'layout_optimization',
      });

      database.on(checkpoints).insert.returnsRaw([mockRow]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'agent-uuid-001',
        createdByType: 'agent',
        operationType: 'layout_optimization',
      });

      expect(result.checkpoint.operationType).toBe('layout_optimization');
    });

    it('should accept affectedRegions field', async () => {
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = insertedCheckpointRow({
        affected_regions: ['/content/0', '/content/1/props'],
      });

      database.on(checkpoints).insert.returnsRaw([mockRow]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'agent-uuid-001',
        createdByType: 'agent',
        affectedRegions: ['/content/0', '/content/1/props'],
      });

      expect(result.checkpoint.affectedRegions).toEqual(['/content/0', '/content/1/props']);
    });

    it('should default trigger to manual when not provided', async () => {
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = insertedCheckpointRow({
        trigger: 'manual',
      });

      database.on(checkpoints).insert.returnsRaw([mockRow]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        // No trigger provided
      });

      expect(result.checkpoint.trigger).toBe('manual');
    });

    it('should default status to completed when not provided', async () => {
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = insertedCheckpointRow({
        status: 'completed',
      });

      database.on(checkpoints).insert.returnsRaw([mockRow]);

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.checkpoint.status).toBe('completed');
    });
  });

  describe('updateCheckpointStatus', () => {
    it('should update checkpoint status to rolled_back', async () => {
      const { updateCheckpointStatus } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = checkpointRow({
        status: 'rolled_back',
        rolledBackById: 'user-uuid-123',
        rolledBackAt: '2026-01-26T11:00:00.000Z',
      });

      database.on(checkpoints).update.returnsRaw([mockRow]);

      const result = await updateCheckpointStatus(
        'checkpoint-uuid-123',
        'rolled_back',
        'user-uuid-123',
      );

      expect(result.status).toBe('rolled_back');
      expect(result.rolledBackById).toBe('user-uuid-123');
      expect(result.rolledBackAt).toBeDefined();
    });

    it('should update checkpoint status to partial', async () => {
      const { updateCheckpointStatus } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = checkpointRow({
        status: 'partial',
      });

      database.on(checkpoints).update.returnsRaw([mockRow]);

      const result = await updateCheckpointStatus('checkpoint-uuid-123', 'partial');

      expect(result.status).toBe('partial');
    });

    it('should throw when checkpoint not found', async () => {
      const { updateCheckpointStatus, CheckpointNotFoundError } = await import(
        '../../src/services/checkpoint-service'
      );


      await expect(
        updateCheckpointStatus('nonexistent-id', 'rolled_back'),
      ).rejects.toThrow(CheckpointNotFoundError);
    });

    it('should include rolled_back_by_id when provided', async () => {
      const { updateCheckpointStatus } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = checkpointRow({
        status: 'rolled_back',
        rolledBackById: 'admin-uuid-999',
      });

      database.on(checkpoints).update.returnsRaw([mockRow]);

      await updateCheckpointStatus('checkpoint-uuid-123', 'rolled_back', 'admin-uuid-999');

      const [update] = database.calls(checkpoints).update;
      expect(update.sql).toContain('rolled_back_by_id');
      expect(update.params).toContain('admin-uuid-999');
    });
  });

  describe('listCheckpointsByAgent', () => {
    it('should list all checkpoints created by an agent', async () => {
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRows = [
        checkpointRow({ id: 'checkpoint-1' }),
        checkpointRow({ id: 'checkpoint-2' }),
      ];

      database.on(checkpoints).select.returnsRaw(mockRows);

      const result = await listCheckpointsByAgent('agent-uuid-001');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('checkpoint-1');
      expect(result[1].id).toBe('checkpoint-2');
    });

    it('should filter by branch when provided', async () => {
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );


      await listCheckpointsByAgent('agent-uuid-001', { branchId: 'branch-123' });

      const [listing] = database.calls(checkpoints).select;
      expect(listing.sql).toContain('branch_id');
      expect(listing.params).toContain('branch-123');
    });

    it('should filter by status when provided', async () => {
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );


      await listCheckpointsByAgent('agent-uuid-001', { status: 'rolled_back' });

      const [listing] = database.calls(checkpoints).select;
      expect(listing.sql).toContain('status');
      expect(listing.params).toContain('rolled_back');
    });

    it('should filter by trigger when provided', async () => {
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );


      await listCheckpointsByAgent('agent-uuid-001', { trigger: 'autonomous' });

      const [listing] = database.calls(checkpoints).select;
      expect(listing.sql).toContain('trigger');
      expect(listing.params).toContain('autonomous');
    });

    it('should support limit and offset', async () => {
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );


      await listCheckpointsByAgent('agent-uuid-001', { limit: 10, offset: 20 });

      const [listing] = database.calls(checkpoints).select;
      expect(listing.params).toEqual(expect.arrayContaining([10, 20]));
    });

    it('should return empty array when no checkpoints found', async () => {
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );


      const result = await listCheckpointsByAgent('agent-with-no-checkpoints');

      expect(result).toEqual([]);
    });
  });

  describe('listCheckpointsByOperationType', () => {
    it('should list checkpoints by operation type on a branch', async () => {
      const { listCheckpointsByOperationType } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRows = [
        checkpointRow({
          id: 'checkpoint-1',
          operationType: 'layout_optimization',
        }),
        checkpointRow({
          id: 'checkpoint-2',
          operationType: 'layout_optimization',
        }),
      ];

      database.on(checkpoints).select.returnsRaw(mockRows);

      const result = await listCheckpointsByOperationType(
        'branch-uuid-789',
        'layout_optimization',
      );

      expect(result).toHaveLength(2);
      expect(result[0].operationType).toBe('layout_optimization');
    });

    it('should return empty array when no matching checkpoints', async () => {
      const { listCheckpointsByOperationType } = await import(
        '../../src/services/checkpoint-service'
      );


      const result = await listCheckpointsByOperationType(
        'branch-uuid-789',
        'nonexistent_operation',
      );

      expect(result).toEqual([]);
    });

    it('should order by created_at descending', async () => {
      const { listCheckpointsByOperationType } = await import(
        '../../src/services/checkpoint-service'
      );


      await listCheckpointsByOperationType('branch-uuid-789', 'content_edit');

      expect(database.calls(checkpoints).select[0].sql).toContain('order by');
    });
  });

  describe('revertToCheckpoint with status tracking', () => {
    it('should update original checkpoint status to rolled_back', async () => {
      const { revertToCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const originalCheckpoint = checkpointRow({
        id: 'original-checkpoint',
        status: 'completed',
      });

      const newCheckpoint = insertedCheckpointRow({
        id: 'revert-checkpoint',
        message: 'Reverted to checkpoint: Agent checkpoint (original-checkpoint)',
      });

      database.on(checkpoints).select.returnsRaw([originalCheckpoint]);
      database.on(checkpoints).insert.returnsRaw([newCheckpoint]);

      await revertToCheckpoint({
        checkpointId: 'original-checkpoint',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Verify that the original checkpoint status was updated
      const [update] = database.calls(checkpoints).update;
      expect(update.params).toContain('rolled_back');
    });

    it('should record who performed the rollback', async () => {
      const { revertToCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const originalCheckpoint = checkpointRow({
        id: 'original-checkpoint',
      });

      const newCheckpoint = insertedCheckpointRow({
        id: 'revert-checkpoint',
      });

      database.on(checkpoints).select.returnsRaw([originalCheckpoint]);
      database.on(checkpoints).insert.returnsRaw([newCheckpoint]);

      await revertToCheckpoint({
        checkpointId: 'original-checkpoint',
        createdById: 'admin-uuid-999',
        createdByType: 'user',
      });

      // Verify rolled_back_by_id was included in the update
      const [update] = database.calls(checkpoints).update;
      expect(update.sql).toContain('rolled_back_by_id');
      expect(update.params).toContain('admin-uuid-999');
    });

    it('should record rollback timestamp', async () => {
      const { revertToCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const originalCheckpoint = checkpointRow({
        id: 'original-checkpoint',
      });

      const newCheckpoint = insertedCheckpointRow({
        id: 'revert-checkpoint',
      });

      database.on(checkpoints).select.returnsRaw([originalCheckpoint]);
      database.on(checkpoints).insert.returnsRaw([newCheckpoint]);

      await revertToCheckpoint({
        checkpointId: 'original-checkpoint',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Verify rolled_back_at was included in the update
      const [update] = database.calls(checkpoints).update;
      expect(update.sql).toContain('rolled_back_at');
      // The driver binds a timestamp as text, so the moment is in the params.
      expect(update.params.some(
        (param) => typeof param === 'string' && !Number.isNaN(Date.parse(param)),
      )).toBe(true);
    });
  });

  describe('getCheckpoint with enhanced fields', () => {
    it('should return checkpoint with all enhanced fields', async () => {
      const { getCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = checkpointRow({
        description: 'Test description',
        trigger: 'autonomous',
        requestedById: 'user-123',
        operationType: 'content_edit',
        affectedRegions: ['/content/0'],
        status: 'completed',
      });

      database.on(checkpoints).select.returnsRaw([mockRow]);

      const result = await getCheckpoint('checkpoint-uuid-123');

      expect(result).not.toBeNull();
      expect(result?.description).toBe('Test description');
      expect(result?.trigger).toBe('autonomous');
      expect(result?.requestedById).toBe('user-123');
      expect(result?.operationType).toBe('content_edit');
      expect(result?.affectedRegions).toEqual(['/content/0']);
      expect(result?.status).toBe('completed');
    });

    it('should return checkpoint with rollback information', async () => {
      const { getCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = checkpointRow({
        status: 'rolled_back',
        rolledBackById: 'admin-uuid',
        rolledBackAt: '2026-01-26T15:00:00.000Z',
      });

      database.on(checkpoints).select.returnsRaw([mockRow]);

      const result = await getCheckpoint('checkpoint-uuid-123');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('rolled_back');
      expect(result?.rolledBackById).toBe('admin-uuid');
      expect(result?.rolledBackAt).toBe('2026-01-26T15:00:00.000Z');
    });
  });
});
