/**
 * Agent Politeness System - Phase 2.3: Agent Edit Permission Service Tests (TDD)
 *
 * Tests for agent edit permission workflow.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Agent Politeness Phase 2.3: Agent Edit Permission Service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('AgentEditPermissionService', () => {
    describe('constructor', () => {
      it('should create service with activity detector', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector();
        const service = new AgentEditPermissionService({ activityDetector });

        expect(service).toBeDefined();
      });

      it('should create service with custom idle timeout', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 10000 });
        const service = new AgentEditPermissionService({ activityDetector });

        expect(service.getIdleTimeoutMs()).toBe(10000);
      });
    });

    describe('canAgentEdit', () => {
      it('should allow human-requested work immediately', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        // Record recent human activity
        activityDetector.recordHumanActivity('user-123', ['/content/0']);

        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'human_requested',
          intent: 'User requested help',
          targetRegions: ['/content/0'],
        });

        expect(result.allowed).toBe(true);
      });

      it('should deny autonomous work when humans are active', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        // Record recent human activity
        activityDetector.recordHumanActivity('user-123');

        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Autonomous optimization',
          targetRegions: [],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('human_active');
        expect(result.retryAfterMs).toBe(5000);
      });

      it('should deny autonomous work with region conflicts even when idle', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        // Record human activity with regions, then wait for idle
        activityDetector.recordHumanActivity('user-123', ['/content/0']);
        vi.advanceTimersByTime(6000);

        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Autonomous optimization',
          targetRegions: ['/content/0'],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('region_conflict');
        expect(result.conflictingRegions).toContain('/content/0');
      });

      it('should allow autonomous work when idle and no conflicts', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        // Record human activity with regions, then wait for idle
        activityDetector.recordHumanActivity('user-123', ['/content/0']);
        vi.advanceTimersByTime(6000);

        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Autonomous optimization',
          targetRegions: ['/content/1'], // Different region
        });

        expect(result.allowed).toBe(true);
      });

      it('should deny suspended agent', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({
          activityDetector,
          getAgentStatus: (): Promise<'active' | 'suspended' | 'disabled'> =>
            Promise.resolve('suspended'),
        });

        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Autonomous optimization',
          targetRegions: [],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('agent_suspended');
      });

      it('should deny disabled agent', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({
          activityDetector,
          getAgentStatus: (): Promise<'active' | 'suspended' | 'disabled'> =>
            Promise.resolve('disabled'),
        });

        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Autonomous optimization',
          targetRegions: [],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('agent_suspended');
      });

      it('should allow active agent', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({
          activityDetector,
          getAgentStatus: (): Promise<'active' | 'suspended' | 'disabled'> =>
            Promise.resolve('active'),
        });

        // No human activity, agent should be allowed
        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Autonomous optimization',
          targetRegions: [],
        });

        expect(result.allowed).toBe(true);
      });

      it('should calculate correct retryAfterMs', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        activityDetector.recordHumanActivity('user-123');
        vi.advanceTimersByTime(3000);

        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'autonomous',
          intent: 'Autonomous optimization',
          targetRegions: [],
        });

        expect(result.allowed).toBe(false);
        expect(result.retryAfterMs).toBe(2000);
      });

      it('should check agent status before other checks', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({
          activityDetector,
          getAgentStatus: (): Promise<'active' | 'suspended' | 'disabled'> =>
            Promise.resolve('suspended'),
        });

        // Even with human-requested trigger, suspended agent is denied
        const result = await service.canAgentEdit({
          agentId: 'agent-123',
          trigger: 'human_requested',
          intent: 'User requested help',
          targetRegions: [],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('agent_suspended');
      });
    });

    describe('recordHumanActivity', () => {
      it('should delegate to activity detector', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        service.recordHumanActivity('user-123', ['/content/0']);

        expect(activityDetector.getActiveRegions()).toContain('/content/0');
        expect(activityDetector.isHumanIdle()).toBe(false);
      });
    });

    describe('clearRegions', () => {
      it('should delegate to activity detector', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector();
        const service = new AgentEditPermissionService({ activityDetector });

        activityDetector.recordHumanActivity('user-123', ['/content/0']);
        service.clearRegions();

        expect(activityDetector.getActiveRegions()).toEqual([]);
      });
    });

    describe('setIdleTimeout', () => {
      it('should update idle timeout', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        service.setIdleTimeout(10000);

        expect(service.getIdleTimeoutMs()).toBe(10000);
      });
    });

    describe('isHumanIdle', () => {
      it('should return true when no activity', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector();
        const service = new AgentEditPermissionService({ activityDetector });

        expect(service.isHumanIdle()).toBe(true);
      });

      it('should return false when recently active', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        service.recordHumanActivity('user-123');

        expect(service.isHumanIdle()).toBe(false);
      });
    });

    describe('getConflictingRegions', () => {
      it('should return overlapping regions', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector();
        const service = new AgentEditPermissionService({ activityDetector });

        service.recordHumanActivity('user-123', ['/content/0', '/content/1']);

        const conflicts = service.getConflictingRegions(['/content/0', '/content/2']);
        expect(conflicts).toContain('/content/0');
        expect(conflicts).not.toContain('/content/2');
      });
    });

    describe('getActiveRegions', () => {
      it('should return all active regions', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector();
        const service = new AgentEditPermissionService({ activityDetector });

        service.recordHumanActivity('user-123', ['/content/0', '/content/1']);

        expect(service.getActiveRegions()).toContain('/content/0');
        expect(service.getActiveRegions()).toContain('/content/1');
      });
    });

    describe('reset', () => {
      it('should reset all activity state', async () => {
        const { AgentEditPermissionService } = await import(
          '../../src/services/agent-edit-permission-service'
        );
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );

        const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
        const service = new AgentEditPermissionService({ activityDetector });

        service.recordHumanActivity('user-123', ['/content/0']);
        service.reset();

        expect(service.isHumanIdle()).toBe(true);
        expect(service.getActiveRegions()).toEqual([]);
      });
    });
  });
});
