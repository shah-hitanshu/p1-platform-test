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

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Agent Politeness Phase 3: Enhanced Checkpoint Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Enhanced mock checkpoint row type with agent politeness fields
  interface MockEnhancedCheckpointRow {
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
  }

  // Helper to create a mock enhanced checkpoint row
  function createMockEnhancedCheckpointRow(
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
      const { query } = await import('../../src/db');
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        description: 'Detailed description of changes',
      });

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 }) // INSERT checkpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Get latest versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert structures
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

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
      const { query } = await import('../../src/db');
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        trigger: 'human_requested',
      });

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 }) // INSERT checkpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Get latest versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert structures
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

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
      const { query } = await import('../../src/db');
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        trigger: 'human_requested',
        requested_by_id: 'user-uuid-123',
      });

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 }) // INSERT checkpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Get latest versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert structures
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

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
      const { query } = await import('../../src/db');
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        operation_type: 'layout_optimization',
      });

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 }) // INSERT checkpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Get latest versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert structures
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

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
      const { query } = await import('../../src/db');
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        affected_regions: ['/content/0', '/content/1/props'],
      });

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 }) // INSERT checkpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Get latest versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert structures
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

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
      const { query } = await import('../../src/db');
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        trigger: 'manual',
      });

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 }) // INSERT checkpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Get latest versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert structures
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

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
      const { query } = await import('../../src/db');
      const { createCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        status: 'completed',
      });

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 }) // INSERT checkpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Get latest versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert structures
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Insert metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

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
      const { query } = await import('../../src/db');
      const { updateCheckpointStatus } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        status: 'rolled_back',
        rolled_back_by_id: 'user-uuid-123',
        rolled_back_at: '2026-01-26T11:00:00.000Z',
      });

      vi.mocked(query).mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 });

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
      const { query } = await import('../../src/db');
      const { updateCheckpointStatus } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        status: 'partial',
      });

      vi.mocked(query).mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 });

      const result = await updateCheckpointStatus('checkpoint-uuid-123', 'partial');

      expect(result.status).toBe('partial');
    });

    it('should throw when checkpoint not found', async () => {
      const { query } = await import('../../src/db');
      const { updateCheckpointStatus, CheckpointNotFoundError } = await import(
        '../../src/services/checkpoint-service'
      );

      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        updateCheckpointStatus('nonexistent-id', 'rolled_back'),
      ).rejects.toThrow(CheckpointNotFoundError);
    });

    it('should include rolled_back_by_id when provided', async () => {
      const { query } = await import('../../src/db');
      const { updateCheckpointStatus } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        status: 'rolled_back',
        rolled_back_by_id: 'admin-uuid-999',
      });

      vi.mocked(query).mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 });

      await updateCheckpointStatus('checkpoint-uuid-123', 'rolled_back', 'admin-uuid-999');

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('rolled_back_by_id'),
        expect.arrayContaining(['admin-uuid-999']),
      );
    });
  });

  describe('listCheckpointsByAgent', () => {
    it('should list all checkpoints created by an agent', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRows = [
        createMockEnhancedCheckpointRow({ id: 'checkpoint-1' }),
        createMockEnhancedCheckpointRow({ id: 'checkpoint-2' }),
      ];

      vi.mocked(query).mockResolvedValueOnce({ rows: mockRows, rowCount: 2 });

      const result = await listCheckpointsByAgent('agent-uuid-001');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('checkpoint-1');
      expect(result[1].id).toBe('checkpoint-2');
    });

    it('should filter by branch when provided', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );

      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await listCheckpointsByAgent('agent-uuid-001', { branchId: 'branch-123' });

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('branch_id'),
        expect.arrayContaining(['branch-123']),
      );
    });

    it('should filter by status when provided', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );

      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await listCheckpointsByAgent('agent-uuid-001', { status: 'rolled_back' });

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        expect.arrayContaining(['rolled_back']),
      );
    });

    it('should filter by trigger when provided', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );

      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await listCheckpointsByAgent('agent-uuid-001', { trigger: 'autonomous' });

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('trigger'),
        expect.arrayContaining(['autonomous']),
      );
    });

    it('should support limit and offset', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );

      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await listCheckpointsByAgent('agent-uuid-001', { limit: 10, offset: 20 });

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([10, 20]),
      );
    });

    it('should return empty array when no checkpoints found', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByAgent } = await import(
        '../../src/services/checkpoint-service'
      );

      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await listCheckpointsByAgent('agent-with-no-checkpoints');

      expect(result).toEqual([]);
    });
  });

  describe('listCheckpointsByOperationType', () => {
    it('should list checkpoints by operation type on a branch', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByOperationType } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRows = [
        createMockEnhancedCheckpointRow({
          id: 'checkpoint-1',
          operation_type: 'layout_optimization',
        }),
        createMockEnhancedCheckpointRow({
          id: 'checkpoint-2',
          operation_type: 'layout_optimization',
        }),
      ];

      vi.mocked(query).mockResolvedValueOnce({ rows: mockRows, rowCount: 2 });

      const result = await listCheckpointsByOperationType(
        'branch-uuid-789',
        'layout_optimization',
      );

      expect(result).toHaveLength(2);
      expect(result[0].operationType).toBe('layout_optimization');
    });

    it('should return empty array when no matching checkpoints', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByOperationType } = await import(
        '../../src/services/checkpoint-service'
      );

      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await listCheckpointsByOperationType(
        'branch-uuid-789',
        'nonexistent_operation',
      );

      expect(result).toEqual([]);
    });

    it('should order by created_at descending', async () => {
      const { query } = await import('../../src/db');
      const { listCheckpointsByOperationType } = await import(
        '../../src/services/checkpoint-service'
      );

      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await listCheckpointsByOperationType('branch-uuid-789', 'content_edit');

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY'),
        expect.any(Array),
      );
    });
  });

  describe('revertToCheckpoint with status tracking', () => {
    it('should update original checkpoint status to rolled_back', async () => {
      const { query } = await import('../../src/db');
      const { revertToCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const originalCheckpoint = createMockEnhancedCheckpointRow({
        id: 'original-checkpoint',
        status: 'completed',
      });

      const newCheckpoint = createMockEnhancedCheckpointRow({
        id: 'revert-checkpoint',
        message: 'Reverted to checkpoint: Agent checkpoint (original-checkpoint)',
      });

      // Mock sequence of queries for revert
      vi.mocked(query)
        // getCheckpoint
        .mockResolvedValueOnce({ rows: [originalCheckpoint], rowCount: 1 })
        // getDocumentsAtCheckpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // revertToCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // getStructuresAtCheckpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Delete structure state
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Restore structure state
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Delete metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Restore metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // inline UPDATE checkpoint status to rolled_back
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // revertToCheckpoint: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // createCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Create new checkpoint
        .mockResolvedValueOnce({ rows: [newCheckpoint], rowCount: 1 })
        // Get latest versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Insert structures
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Insert metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // createCheckpoint: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await revertToCheckpoint({
        checkpointId: 'original-checkpoint',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Verify that the original checkpoint status was updated
      const updateCall = vi.mocked(query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE') &&
          call[0].includes('status'),
      );
      expect(updateCall).toBeDefined();
    });

    it('should record who performed the rollback', async () => {
      const { query } = await import('../../src/db');
      const { revertToCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const originalCheckpoint = createMockEnhancedCheckpointRow({
        id: 'original-checkpoint',
      });

      const newCheckpoint = createMockEnhancedCheckpointRow({
        id: 'revert-checkpoint',
      });

      // Mock sequence of queries for revert
      vi.mocked(query)
        // getCheckpoint
        .mockResolvedValueOnce({ rows: [originalCheckpoint], rowCount: 1 })
        // getDocumentsAtCheckpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // revertToCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // getStructuresAtCheckpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Delete structure state
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Restore structure state
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Delete metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Restore metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // inline UPDATE checkpoint status to rolled_back
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // revertToCheckpoint: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // createCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Create new checkpoint
        .mockResolvedValueOnce({ rows: [newCheckpoint], rowCount: 1 })
        // Select document versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Structure capture
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Metadata capture
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // createCheckpoint: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await revertToCheckpoint({
        checkpointId: 'original-checkpoint',
        createdById: 'admin-uuid-999',
        createdByType: 'user',
      });

      // Verify rolled_back_by_id was included in the update
      const updateCall = vi.mocked(query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('rolled_back_by_id'),
      );
      expect(updateCall).toBeDefined();
    });

    it('should record rollback timestamp', async () => {
      const { query } = await import('../../src/db');
      const { revertToCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const originalCheckpoint = createMockEnhancedCheckpointRow({
        id: 'original-checkpoint',
      });

      const newCheckpoint = createMockEnhancedCheckpointRow({
        id: 'revert-checkpoint',
      });

      // Mock sequence of queries for revert
      vi.mocked(query)
        // getCheckpoint
        .mockResolvedValueOnce({ rows: [originalCheckpoint], rowCount: 1 })
        // getDocumentsAtCheckpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // revertToCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // getStructuresAtCheckpoint
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Delete structure state
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Restore structure state
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Delete metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Restore metadata
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // inline UPDATE checkpoint status to rolled_back
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // revertToCheckpoint: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // createCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Create new checkpoint
        .mockResolvedValueOnce({ rows: [newCheckpoint], rowCount: 1 })
        // Select document versions
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Structure capture
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Metadata capture
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // createCheckpoint: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await revertToCheckpoint({
        checkpointId: 'original-checkpoint',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Verify rolled_back_at was included in the update
      const updateCall = vi.mocked(query).mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('rolled_back_at'),
      );
      expect(updateCall).toBeDefined();
    });
  });

  describe('getCheckpoint with enhanced fields', () => {
    it('should return checkpoint with all enhanced fields', async () => {
      const { query } = await import('../../src/db');
      const { getCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        description: 'Test description',
        trigger: 'autonomous',
        requested_by_id: 'user-123',
        operation_type: 'content_edit',
        affected_regions: ['/content/0'],
        status: 'completed',
      });

      vi.mocked(query).mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 });

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
      const { query } = await import('../../src/db');
      const { getCheckpoint } = await import(
        '../../src/services/checkpoint-service'
      );

      const mockRow = createMockEnhancedCheckpointRow({
        status: 'rolled_back',
        rolled_back_by_id: 'admin-uuid',
        rolled_back_at: '2026-01-26T15:00:00.000Z',
      });

      vi.mocked(query).mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 });

      const result = await getCheckpoint('checkpoint-uuid-123');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('rolled_back');
      expect(result?.rolledBackById).toBe('admin-uuid');
      expect(result?.rolledBackAt).toBe('2026-01-26T15:00:00.000Z');
    });
  });
});
