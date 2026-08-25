/**
 * Agent Politeness System - Phase 1.4: Agent Registry Service Tests (TDD)
 *
 * Tests for Agent CRUD operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentSettings, AgentStatus } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Agent Politeness Phase 1.4: Agent Registry Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Default agent settings
  const defaultAgentSettings: AgentSettings = {};

  // Mock agent row type (database format)
  interface MockAgentRow {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    capabilities: string[];
    status: AgentStatus;
    settings: AgentSettings | string;
    created_at: string;
    updated_at: string;
  }

  // Helper to create a mock agent row (database format)
  function createMockAgentRow(overrides: Partial<MockAgentRow> = {}): MockAgentRow {
    return {
      id: 'agent-uuid-123',
      organization_id: 'org-uuid-123',
      name: 'Test Agent',
      description: 'A test agent',
      capabilities: ['edit', 'create'],
      status: 'active',
      settings: defaultAgentSettings,
      created_at: '2026-01-26T12:00:00.000Z',
      updated_at: '2026-01-26T12:00:00.000Z',
      ...overrides,
    };
  }

  describe('createAgent', () => {
    it('should create an agent with required fields', async () => {
      const { createAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createAgent({
        organizationId: 'org-uuid-123',
        name: 'Test Agent',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Agent');
      expect(result.organizationId).toBe('org-uuid-123');
      expect(result.id).toBeDefined();
      expect(result.status).toBe('active');
      expect(result.capabilities).toEqual(['edit', 'create']);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create an agent with description and capabilities', async () => {
      const { createAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow({
        description: 'A helpful editing agent',
        capabilities: ['edit', 'create', 'delete'],
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createAgent({
        organizationId: 'org-uuid-123',
        name: 'Editor Agent',
        description: 'A helpful editing agent',
        capabilities: ['edit', 'create', 'delete'],
      });

      expect(result.description).toBe('A helpful editing agent');
      expect(result.capabilities).toEqual(['edit', 'create', 'delete']);
    });

    it('should create an agent with custom settings', async () => {
      const { createAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const customSettings: AgentSettings = {
        priorityTier: 'high',
      };
      const mockRow = createMockAgentRow({ settings: customSettings });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createAgent({
        organizationId: 'org-uuid-123',
        name: 'Priority Agent',
        settings: customSettings,
      });

      expect(result.settings.priorityTier).toBe('high');
    });

    it('should throw InvalidAgentParamsError for empty name', async () => {
      const { createAgent } = await import('../../src/services/agent-service');
      const { InvalidAgentParamsError } = await import('../../src/services/errors');

      await expect(
        createAgent({
          organizationId: 'org-uuid-123',
          name: '',
        }),
      ).rejects.toThrow(InvalidAgentParamsError);
    });

    it('should throw InvalidAgentParamsError for whitespace-only name', async () => {
      const { createAgent } = await import('../../src/services/agent-service');
      const { InvalidAgentParamsError } = await import('../../src/services/errors');

      await expect(
        createAgent({
          organizationId: 'org-uuid-123',
          name: '   ',
        }),
      ).rejects.toThrow(InvalidAgentParamsError);
    });

    it('should throw OrganizationNotFoundError when organization does not exist', async () => {
      const { createAgent } = await import('../../src/services/agent-service');
      const { OrganizationNotFoundError } = await import('../../src/services/errors');
      const db = await import('../../src/db');

      // Simulate foreign key constraint violation
      const error = new Error('foreign key constraint violation') as NodeJS.ErrnoException;
      error.code = '23503';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        createAgent({
          organizationId: 'non-existent-org',
          name: 'Test Agent',
        }),
      ).rejects.toThrow(OrganizationNotFoundError);
    });

    it('should throw DuplicateAgentNameError when agent name exists in organization', async () => {
      const { createAgent } = await import('../../src/services/agent-service');
      const { DuplicateAgentNameError } = await import('../../src/services/errors');
      const db = await import('../../src/db');

      // Simulate unique constraint violation
      const error = new Error('duplicate key value violates unique constraint') as NodeJS.ErrnoException;
      error.code = '23505';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        createAgent({
          organizationId: 'org-uuid-123',
          name: 'Existing Agent',
        }),
      ).rejects.toThrow(DuplicateAgentNameError);
    });
  });

  describe('getAgentById', () => {
    it('should return an agent by ID', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getAgentById('agent-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('agent-uuid-123');
      expect(result?.name).toBe('Test Agent');
      expect(result?.organizationId).toBe('org-uuid-123');
    });

    it('should return null for non-existent agent', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getAgentById('non-existent-id');

      expect(result).toBeNull();
    });

    it('should parse settings from string format (JSONB)', async () => {
      const { getAgentById } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow({
        settings: JSON.stringify({ priorityTier: 'low' }),
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getAgentById('agent-uuid-123');

      expect(result?.settings.priorityTier).toBe('low');
    });
  });

  describe('getAgentByName', () => {
    it('should return an agent by organization and name', async () => {
      const { getAgentByName } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getAgentByName('org-uuid-123', 'Test Agent');

      expect(result).toBeDefined();
      expect(result?.name).toBe('Test Agent');
      expect(result?.organizationId).toBe('org-uuid-123');
    });

    it('should return null when agent name not found in organization', async () => {
      const { getAgentByName } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getAgentByName('org-uuid-123', 'Non-Existent Agent');

      expect(result).toBeNull();
    });
  });

  describe('updateAgent', () => {
    it('should update agent name', async () => {
      const { updateAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow({ name: 'Updated Agent' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateAgent('agent-uuid-123', {
        name: 'Updated Agent',
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Updated Agent');
    });

    it('should update agent description', async () => {
      const { updateAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow({ description: 'New description' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateAgent('agent-uuid-123', {
        description: 'New description',
      });

      expect(result?.description).toBe('New description');
    });

    it('should update agent capabilities', async () => {
      const { updateAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const newCapabilities = ['edit', 'create', 'delete', 'merge'];
      const mockRow = createMockAgentRow({ capabilities: newCapabilities });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateAgent('agent-uuid-123', {
        capabilities: newCapabilities,
      });

      expect(result?.capabilities).toEqual(newCapabilities);
    });

    it('should update agent settings', async () => {
      const { updateAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const updatedSettings: AgentSettings = {
        priorityTier: 'urgent',
      };
      const mockRow = createMockAgentRow({ settings: updatedSettings });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateAgent('agent-uuid-123', {
        settings: updatedSettings,
      });

      expect(result?.settings.priorityTier).toBe('urgent');
    });

    it('should return null for non-existent agent', async () => {
      const { updateAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await updateAgent('non-existent-id', {
        name: 'New Name',
      });

      expect(result).toBeNull();
    });

    it('should throw InvalidAgentParamsError for empty name', async () => {
      const { updateAgent } = await import('../../src/services/agent-service');
      const { InvalidAgentParamsError } = await import('../../src/services/errors');

      await expect(
        updateAgent('agent-uuid-123', {
          name: '',
        }),
      ).rejects.toThrow(InvalidAgentParamsError);
    });

    it('should throw DuplicateAgentNameError when name conflicts', async () => {
      const { updateAgent } = await import('../../src/services/agent-service');
      const { DuplicateAgentNameError } = await import('../../src/services/errors');
      const db = await import('../../src/db');

      // Simulate unique constraint violation
      const error = new Error('duplicate key value violates unique constraint') as NodeJS.ErrnoException;
      error.code = '23505';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        updateAgent('agent-uuid-123', {
          name: 'Conflicting Name',
        }),
      ).rejects.toThrow(DuplicateAgentNameError);
    });
  });

  describe('updateAgentStatus', () => {
    it('should update agent status to suspended', async () => {
      const { updateAgentStatus } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow({ status: 'suspended' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateAgentStatus('agent-uuid-123', 'suspended');

      expect(result).toBeDefined();
      expect(result?.status).toBe('suspended');
    });

    it('should update agent status to disabled', async () => {
      const { updateAgentStatus } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow({ status: 'disabled' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateAgentStatus('agent-uuid-123', 'disabled');

      expect(result?.status).toBe('disabled');
    });

    it('should update agent status to active', async () => {
      const { updateAgentStatus } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRow = createMockAgentRow({ status: 'active' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateAgentStatus('agent-uuid-123', 'active');

      expect(result?.status).toBe('active');
    });

    it('should return null for non-existent agent', async () => {
      const { updateAgentStatus } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await updateAgentStatus('non-existent-id', 'suspended');

      expect(result).toBeNull();
    });
  });

  describe('deleteAgent', () => {
    it('should delete an agent and return true', async () => {
      const { deleteAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'agent-uuid-123' }] });

      const result = await deleteAgent('agent-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false for non-existent agent', async () => {
      const { deleteAgent } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await deleteAgent('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('listAgents', () => {
    it('should list all agents', async () => {
      const { listAgents } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockAgentRow({ id: 'agent-1', name: 'Agent One' }),
        createMockAgentRow({ id: 'agent-2', name: 'Agent Two' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listAgents();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Agent One');
      expect(result[1].name).toBe('Agent Two');
    });

    it('should return empty array when no agents exist', async () => {
      const { listAgents } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listAgents();

      expect(result).toEqual([]);
    });

    it('should support pagination with limit and offset', async () => {
      const { listAgents } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRows = [createMockAgentRow({ id: 'agent-2', name: 'Agent Two' })];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listAgents({ limit: 1, offset: 1 });

      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      const { listAgents } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRows = [createMockAgentRow({ id: 'agent-1', status: 'active' })];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listAgents({ status: 'active' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
    });
  });

  describe('getAgentsByOrganization', () => {
    it('should return all agents for an organization', async () => {
      const { getAgentsByOrganization } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockAgentRow({ id: 'agent-1', name: 'Agent One', organization_id: 'org-uuid-123' }),
        createMockAgentRow({ id: 'agent-2', name: 'Agent Two', organization_id: 'org-uuid-123' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await getAgentsByOrganization('org-uuid-123');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Agent One');
      expect(result[1].name).toBe('Agent Two');
      expect(result[0].organizationId).toBe('org-uuid-123');
    });

    it('should return empty array when organization has no agents', async () => {
      const { getAgentsByOrganization } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getAgentsByOrganization('org-with-no-agents');

      expect(result).toEqual([]);
    });

    it('should filter by status within organization', async () => {
      const { getAgentsByOrganization } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      const mockRows = [createMockAgentRow({ id: 'agent-1', status: 'active' })];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await getAgentsByOrganization('org-uuid-123', { status: 'active' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
    });
  });

  describe('getActiveAgentCount', () => {
    it('should return count of active agents for an organization', async () => {
      const { getActiveAgentCount } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ count: '5' }] });

      const result = await getActiveAgentCount('org-uuid-123');

      expect(result).toBe(5);
    });

    it('should return 0 when no active agents exist', async () => {
      const { getActiveAgentCount } = await import('../../src/services/agent-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ count: '0' }] });

      const result = await getActiveAgentCount('org-with-no-agents');

      expect(result).toBe(0);
    });
  });
});
