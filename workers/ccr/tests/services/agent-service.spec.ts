/**
 * Agent Politeness System - Phase 1.4: Agent Registry Service Tests (TDD)
 *
 * Tests for Agent CRUD operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { InferSelectModel } from 'drizzle-orm';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { agents } from '../../src/db/schema';
import type { AgentSettings } from '../../src/types';
import {
  createAgent,
  getAgentById,
  getAgentByName,
  updateAgent,
  updateAgentStatus,
  deleteAgent,
  listAgents,
  getAgentsByOrganization,
  getActiveAgentCount,
} from '../../src/services/agent-service';
import {
  DuplicateAgentIdError,
  DuplicateAgentNameError,
  InvalidAgentParamsError,
  OrganizationNotFoundError,
} from '../../src/services/errors';

describe('Agent Politeness Phase 1.4: Agent Registry Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  // Default agent settings
  const defaultAgentSettings: AgentSettings = {};

  const createdAt = new Date('2026-01-26T12:00:00.000Z');
  const updatedAt = new Date('2026-01-26T12:00:00.000Z');

  type AgentRow = InferSelectModel<typeof agents>;

  // Helper to create a stub agent row
  function createAgentRow(overrides: Partial<AgentRow> = {}): Partial<AgentRow> {
    return {
      id: 'agent-uuid-123',
      organizationId: 'org-uuid-123',
      name: 'Test Agent',
      description: 'A test agent',
      capabilities: ['edit', 'create'],
      status: 'active',
      settings: defaultAgentSettings,
      createdAt,
      updatedAt,
      ...overrides,
    };
  }

  /** The error shape postgres raises for a constraint violation. */
  function constraintViolation(code: string, constraintName: string): Error {
    return Object.assign(new Error('constraint violation'), {
      code,
      constraint_name: constraintName,
    });
  }

  describe('createAgent', () => {
    it('should create an agent with required fields', async () => {
      database.on(agents).insert.returns([createAgentRow()]);

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
      expect(result.createdAt).toEqual(createdAt);
      expect(result.updatedAt).toEqual(updatedAt);
    });

    it('should create an agent with description and capabilities', async () => {
      database.on(agents).insert.returns([
        createAgentRow({
          description: 'A helpful editing agent',
          capabilities: ['edit', 'create', 'delete'],
        }),
      ]);

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
      const customSettings: AgentSettings = {
        priorityTier: 'high',
      };
      database.on(agents).insert.returns([createAgentRow({ settings: customSettings })]);

      const result = await createAgent({
        organizationId: 'org-uuid-123',
        name: 'Priority Agent',
        settings: customSettings,
      });

      expect(result.settings.priorityTier).toBe('high');
      expect(database.calls(agents).insert[0].params).toContain(JSON.stringify(customSettings));
    });

    it('should throw InvalidAgentParamsError for empty name', async () => {
      await expect(
        createAgent({
          organizationId: 'org-uuid-123',
          name: '',
        }),
      ).rejects.toThrow(InvalidAgentParamsError);
    });

    it('should throw InvalidAgentParamsError for whitespace-only name', async () => {
      await expect(
        createAgent({
          organizationId: 'org-uuid-123',
          name: '   ',
        }),
      ).rejects.toThrow(InvalidAgentParamsError);
    });

    it('should throw OrganizationNotFoundError when organization does not exist', async () => {
      database
        .on(agents)
        .insert.rejects(constraintViolation('23503', 'agents_organization_id_fkey'));

      await expect(
        createAgent({
          organizationId: 'non-existent-org',
          name: 'Test Agent',
        }),
      ).rejects.toThrow(OrganizationNotFoundError);
    });

    it('should throw DuplicateAgentNameError when agent name exists in organization', async () => {
      database
        .on(agents)
        .insert.rejects(constraintViolation('23505', 'agents_organization_id_name_key'));

      await expect(
        createAgent({
          organizationId: 'org-uuid-123',
          name: 'Existing Agent',
        }),
      ).rejects.toThrow(DuplicateAgentNameError);
    });

    it('should throw DuplicateAgentIdError when the primary key is the violated constraint', async () => {
      database.on(agents).insert.rejects(constraintViolation('23505', 'agents_pkey'));

      await expect(
        createAgent({
          id: 'agent-uuid-123',
          organizationId: 'org-uuid-123',
          name: 'Test Agent',
        }),
      ).rejects.toThrow(DuplicateAgentIdError);
    });
  });

  describe('getAgentById', () => {
    it('should return an agent by ID', async () => {
      database.on(agents).select.returns([createAgentRow()]);

      const result = await getAgentById('agent-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('agent-uuid-123');
      expect(result?.name).toBe('Test Agent');
      expect(result?.organizationId).toBe('org-uuid-123');
      expect(database.calls(agents).select[0].params).toEqual(['agent-uuid-123']);
    });

    it('should return null for non-existent agent', async () => {
      const result = await getAgentById('non-existent-id');

      expect(result).toBeNull();
    });

    it('should return the settings object the jsonb column holds', async () => {
      database.on(agents).select.returns([createAgentRow({ settings: { priorityTier: 'low' } })]);

      const result = await getAgentById('agent-uuid-123');

      expect(result?.settings).toEqual({ priorityTier: 'low' });
    });
  });

  describe('getAgentByName', () => {
    it('should return an agent by organization and name', async () => {
      database.on(agents).select.returns([createAgentRow()]);

      const result = await getAgentByName('org-uuid-123', 'Test Agent');

      expect(result).toBeDefined();
      expect(result?.name).toBe('Test Agent');
      expect(result?.organizationId).toBe('org-uuid-123');
      expect(database.calls(agents).select[0].params).toEqual(['org-uuid-123', 'Test Agent']);
    });

    it('should return null when agent name not found in organization', async () => {
      const result = await getAgentByName('org-uuid-123', 'Non-Existent Agent');

      expect(result).toBeNull();
    });
  });

  describe('updateAgent', () => {
    it('should update agent name', async () => {
      database.on(agents).update.returns([createAgentRow({ name: 'Updated Agent' })]);

      const result = await updateAgent('agent-uuid-123', {
        name: 'Updated Agent',
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Updated Agent');
      expect(database.calls(agents).update[0].params).toEqual(['Updated Agent', 'agent-uuid-123']);
    });

    it('should update agent description', async () => {
      database.on(agents).update.returns([createAgentRow({ description: 'New description' })]);

      const result = await updateAgent('agent-uuid-123', {
        description: 'New description',
      });

      expect(result?.description).toBe('New description');
      expect(database.calls(agents).update[0].params).toEqual(['New description', 'agent-uuid-123']);
    });

    it('should update agent capabilities', async () => {
      const newCapabilities = ['edit', 'create', 'delete', 'merge'];
      database.on(agents).update.returns([createAgentRow({ capabilities: newCapabilities })]);

      const result = await updateAgent('agent-uuid-123', {
        capabilities: newCapabilities,
      });

      expect(result?.capabilities).toEqual(newCapabilities);
    });

    it('should merge supplied settings into the stored value', async () => {
      const updatedSettings: AgentSettings = {
        priorityTier: 'urgent',
      };
      database.on(agents).update.returns([createAgentRow({ settings: updatedSettings })]);

      const result = await updateAgent('agent-uuid-123', {
        settings: updatedSettings,
      });

      expect(result?.settings.priorityTier).toBe('urgent');
      expect(database.calls(agents).update[0].params).toEqual([
        JSON.stringify(updatedSettings),
        'agent-uuid-123',
      ]);
    });

    it('should return null for non-existent agent', async () => {
      const result = await updateAgent('non-existent-id', {
        name: 'New Name',
      });

      expect(result).toBeNull();
    });

    it('should read back current state when no fields are supplied', async () => {
      database.on(agents).select.returns([createAgentRow()]);

      const result = await updateAgent('agent-uuid-123', {});

      expect(result?.name).toBe('Test Agent');
      expect(database.calls(agents).update).toHaveLength(0);
    });

    it('should throw InvalidAgentParamsError for empty name', async () => {
      await expect(
        updateAgent('agent-uuid-123', {
          name: '',
        }),
      ).rejects.toThrow(InvalidAgentParamsError);
    });

    it('should throw DuplicateAgentNameError when name conflicts', async () => {
      database
        .on(agents)
        .update.rejects(constraintViolation('23505', 'agents_organization_id_name_key'));

      await expect(
        updateAgent('agent-uuid-123', {
          name: 'Conflicting Name',
        }),
      ).rejects.toThrow(DuplicateAgentNameError);
    });
  });

  describe('updateAgentStatus', () => {
    it('should update agent status to suspended', async () => {
      database.on(agents).update.returns([createAgentRow({ status: 'suspended' })]);

      const result = await updateAgentStatus('agent-uuid-123', 'suspended');

      expect(result).toBeDefined();
      expect(result?.status).toBe('suspended');
      expect(database.calls(agents).update[0].params).toEqual(['suspended', 'agent-uuid-123']);
    });

    it('should update agent status to disabled', async () => {
      database.on(agents).update.returns([createAgentRow({ status: 'disabled' })]);

      const result = await updateAgentStatus('agent-uuid-123', 'disabled');

      expect(result?.status).toBe('disabled');
    });

    it('should update agent status to active', async () => {
      database.on(agents).update.returns([createAgentRow({ status: 'active' })]);

      const result = await updateAgentStatus('agent-uuid-123', 'active');

      expect(result?.status).toBe('active');
    });

    it('should return null for non-existent agent', async () => {
      const result = await updateAgentStatus('non-existent-id', 'suspended');

      expect(result).toBeNull();
    });
  });

  describe('deleteAgent', () => {
    it('should delete an agent and return true', async () => {
      database.on(agents).delete.returns([{ id: 'agent-uuid-123' }]);

      const result = await deleteAgent('agent-uuid-123');

      expect(result).toBe(true);
      expect(database.calls(agents).delete[0].params).toEqual(['agent-uuid-123']);
    });

    it('should return false for non-existent agent', async () => {
      const result = await deleteAgent('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('listAgents', () => {
    it('should list all agents', async () => {
      database
        .on(agents)
        .select.returns([
          createAgentRow({ id: 'agent-1', name: 'Agent One' }),
          createAgentRow({ id: 'agent-2', name: 'Agent Two' }),
        ]);

      const result = await listAgents();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Agent One');
      expect(result[1].name).toBe('Agent Two');
    });

    it('should return empty array when no agents exist', async () => {
      const result = await listAgents();

      expect(result).toEqual([]);
    });

    it('should support pagination with limit and offset', async () => {
      database.on(agents).select.returns([createAgentRow({ id: 'agent-2', name: 'Agent Two' })]);

      const result = await listAgents({ limit: 1, offset: 1 });

      expect(result).toHaveLength(1);
      expect(database.calls(agents).select[0].params).toEqual([1, 1]);
    });

    it('should filter by status', async () => {
      database.on(agents).select.returns([createAgentRow({ id: 'agent-1', status: 'active' })]);

      const result = await listAgents({ status: 'active' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
      expect(database.calls(agents).select[0].params).toContain('active');
    });
  });

  describe('getAgentsByOrganization', () => {
    it('should return all agents for an organization', async () => {
      database
        .on(agents)
        .select.returns([
          createAgentRow({ id: 'agent-1', name: 'Agent One', organizationId: 'org-uuid-123' }),
          createAgentRow({ id: 'agent-2', name: 'Agent Two', organizationId: 'org-uuid-123' }),
        ]);

      const result = await getAgentsByOrganization('org-uuid-123');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Agent One');
      expect(result[1].name).toBe('Agent Two');
      expect(result[0].organizationId).toBe('org-uuid-123');
      expect(database.calls(agents).select[0].params).toEqual(['org-uuid-123', true]);
    });

    it('should return empty array when organization has no agents', async () => {
      const result = await getAgentsByOrganization('org-with-no-agents');

      expect(result).toEqual([]);
    });

    it('should filter by status within organization', async () => {
      database.on(agents).select.returns([createAgentRow({ id: 'agent-1', status: 'active' })]);

      const result = await getAgentsByOrganization('org-uuid-123', {
        status: 'active',
      });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
      expect(database.calls(agents).select[0].params).toEqual(['org-uuid-123', true, 'active']);
    });
  });

  describe('getActiveAgentCount', () => {
    it('should return count of active agents for an organization', async () => {
      database.on(agents).select.returnsRaw([{ count: 5 }]);

      const result = await getActiveAgentCount('org-uuid-123');

      expect(result).toBe(5);
      expect(database.calls(agents).select[0].params).toEqual(['org-uuid-123', 'active']);
    });

    it('should return 0 when no active agents exist', async () => {
      database.on(agents).select.returnsRaw([{ count: 0 }]);

      const result = await getActiveAgentCount('org-with-no-agents');

      expect(result).toBe(0);
    });
  });
});
