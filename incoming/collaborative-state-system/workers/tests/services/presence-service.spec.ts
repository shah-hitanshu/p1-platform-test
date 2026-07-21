/**
 * Agent Politeness System - Phase 2.1: Presence Service Tests (TDD)
 *
 * Tests for presence tracking operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';

describe('Agent Politeness Phase 2.1: Presence Service', () => {
  describe('PresenceManager', () => {
    describe('constructor', () => {
      it('should create an empty presence manager', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        expect(manager.getAll()).toEqual([]);
        expect(manager.count()).toBe(0);
      });
    });

    describe('register', () => {
      it('should register a new presence', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const presence = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        expect(presence.id).toBeDefined();
        expect(presence.actorId).toBe('user-123');
        expect(presence.actorType).toBe('user');
        expect(presence.role).toBe('human');
        expect(presence.name).toBe('Test User');
        expect(presence.state).toBe('active');
        expect(presence.joinedAt).toBeDefined();
        expect(presence.lastActivityAt).toBeDefined();
      });

      it('should register an agent with agent role', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const presence = manager.register({
          actorId: 'agent-123',
          actorType: 'agent',
          name: 'Test Agent',
          intent: 'Updating content',
        });

        expect(presence.role).toBe('agent');
        expect(presence.intent).toBe('Updating content');
      });

      it('should register presence with focus regions', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const presence = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
          focusRegions: ['/content/0', '/content/1'],
        });

        expect(presence.focusRegions).toEqual(['/content/0', '/content/1']);
      });

      it('should replace existing presence for same actor', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const updated = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Updated User',
        });

        expect(manager.count()).toBe(1);
        expect(updated.name).toBe('Updated User');
      });

      it('should throw MaxPresencesExceededError when limit reached', async () => {
        const { PresenceManager, MAX_PRESENCES, MaxPresencesExceededError } = await import(
          '../../src/services/presence-service'
        );
        const manager = new PresenceManager();

        // Register up to the limit
        for (let i = 0; i < MAX_PRESENCES; i++) {
          manager.register({
            actorId: `user-${String(i)}`,
            actorType: 'user',
            name: `User ${String(i)}`,
          });
        }

        expect(manager.count()).toBe(MAX_PRESENCES);

        // Next registration should throw
        expect(() =>
          manager.register({
            actorId: 'one-more',
            actorType: 'user',
            name: 'One More User',
          }),
        ).toThrow(MaxPresencesExceededError);
      });

      it('should allow replacement when at limit', async () => {
        const { PresenceManager, MAX_PRESENCES } = await import(
          '../../src/services/presence-service'
        );
        const manager = new PresenceManager();

        // Register up to the limit
        for (let i = 0; i < MAX_PRESENCES; i++) {
          manager.register({
            actorId: `user-${String(i)}`,
            actorType: 'user',
            name: `User ${String(i)}`,
          });
        }

        // Replacing existing actor should work
        const updated = manager.register({
          actorId: 'user-0',
          actorType: 'user',
          name: 'Updated User 0',
        });

        expect(updated.name).toBe('Updated User 0');
        expect(manager.count()).toBe(MAX_PRESENCES);
      });
    });

    describe('get', () => {
      it('should get presence by ID', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const presence = manager.get(registered.id);
        expect(presence).toBeDefined();
        expect(presence?.actorId).toBe('user-123');
      });

      it('should return undefined for non-existent presence', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const presence = manager.get('non-existent');
        expect(presence).toBeUndefined();
      });
    });

    describe('getByActorId', () => {
      it('should get presence by actor ID', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const presence = manager.getByActorId('user-123');
        expect(presence).toBeDefined();
        expect(presence?.name).toBe('Test User');
      });

      it('should return undefined for non-existent actor', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const presence = manager.getByActorId('non-existent');
        expect(presence).toBeUndefined();
      });
    });

    describe('updateState', () => {
      it('should update presence state to editing', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const updated = manager.updateState(registered.id, 'editing');
        expect(updated?.state).toBe('editing');
      });

      it('should update presence state to idle', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const updated = manager.updateState(registered.id, 'idle');
        expect(updated?.state).toBe('idle');
      });

      it('should update lastActivityAt when changing state', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const originalActivity = registered.lastActivityAt;

        // Wait a tiny bit to ensure time difference
        await new Promise((resolve) => setTimeout(resolve, 10));

        const updated = manager.updateState(registered.id, 'editing');
        expect(updated?.lastActivityAt).not.toBe(originalActivity);
      });

      it('should return undefined for non-existent presence', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const result = manager.updateState('non-existent', 'editing');
        expect(result).toBeUndefined();
      });
    });

    describe('updateFocusRegions', () => {
      it('should update focus regions', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const updated = manager.updateFocusRegions(registered.id, ['/content/0', '/content/1']);
        expect(updated?.focusRegions).toEqual(['/content/0', '/content/1']);
      });

      it('should clear focus regions with empty array', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
          focusRegions: ['/content/0'],
        });

        const updated = manager.updateFocusRegions(registered.id, []);
        expect(updated?.focusRegions).toEqual([]);
      });
    });

    describe('updateIntent', () => {
      it('should update agent intent', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'agent-123',
          actorType: 'agent',
          name: 'Test Agent',
        });

        const updated = manager.updateIntent(registered.id, 'Refactoring hero section');
        expect(updated?.intent).toBe('Refactoring hero section');
      });

      it('should clear intent with undefined', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'agent-123',
          actorType: 'agent',
          name: 'Test Agent',
          intent: 'Old intent',
        });

        const updated = manager.updateIntent(registered.id, undefined);
        expect(updated?.intent).toBeUndefined();
      });
    });

    describe('recordActivity', () => {
      it('should update lastActivityAt', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const originalActivity = registered.lastActivityAt;
        await new Promise((resolve) => setTimeout(resolve, 10));

        const updated = manager.recordActivity(registered.id);
        expect(updated?.lastActivityAt).not.toBe(originalActivity);
      });
    });

    describe('unregister', () => {
      it('should remove presence', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const registered = manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const removed = manager.unregister(registered.id);
        expect(removed).toBe(true);
        expect(manager.count()).toBe(0);
      });

      it('should return false for non-existent presence', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const removed = manager.unregister('non-existent');
        expect(removed).toBe(false);
      });
    });

    describe('unregisterByActorId', () => {
      it('should remove presence by actor ID', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({
          actorId: 'user-123',
          actorType: 'user',
          name: 'Test User',
        });

        const removed = manager.unregisterByActorId('user-123');
        expect(removed).toBe(true);
        expect(manager.count()).toBe(0);
      });
    });

    describe('getAll', () => {
      it('should return all presences', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });
        manager.register({ actorId: 'user-2', actorType: 'user', name: 'User 2' });
        manager.register({ actorId: 'agent-1', actorType: 'agent', name: 'Agent 1' });

        const all = manager.getAll();
        expect(all).toHaveLength(3);
      });
    });

    describe('getHumans', () => {
      it('should return only human presences', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });
        manager.register({ actorId: 'user-2', actorType: 'user', name: 'User 2' });
        manager.register({ actorId: 'agent-1', actorType: 'agent', name: 'Agent 1' });

        const humans = manager.getHumans();
        expect(humans).toHaveLength(2);
        expect(humans.every((h) => h.role === 'human')).toBe(true);
      });
    });

    describe('getAgents', () => {
      it('should return only agent presences', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });
        manager.register({ actorId: 'agent-1', actorType: 'agent', name: 'Agent 1' });
        manager.register({ actorId: 'agent-2', actorType: 'agent', name: 'Agent 2' });

        const agents = manager.getAgents();
        expect(agents).toHaveLength(2);
        expect(agents.every((a) => a.role === 'agent')).toBe(true);
      });
    });

    describe('getByState', () => {
      it('should return presences by state', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const p1 = manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });
        manager.register({ actorId: 'user-2', actorType: 'user', name: 'User 2' });

        manager.updateState(p1.id, 'editing');

        const editing = manager.getByState('editing');
        expect(editing).toHaveLength(1);
        expect(editing[0].actorId).toBe('user-1');
      });
    });

    describe('hasHumanPresence', () => {
      it('should return true when humans are present', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });

        expect(manager.hasHumanPresence()).toBe(true);
      });

      it('should return false when only agents are present', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({ actorId: 'agent-1', actorType: 'agent', name: 'Agent 1' });

        expect(manager.hasHumanPresence()).toBe(false);
      });

      it('should return false when empty', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        expect(manager.hasHumanPresence()).toBe(false);
      });
    });

    describe('hasActiveHumans', () => {
      it('should return true when humans are active or editing', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });

        expect(manager.hasActiveHumans()).toBe(true);
      });

      it('should return false when all humans are idle', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        const p = manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });
        manager.updateState(p.id, 'idle');

        expect(manager.hasActiveHumans()).toBe(false);
      });
    });

    describe('getActorsInRegion', () => {
      it('should return actors with overlapping focus regions', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({
          actorId: 'user-1',
          actorType: 'user',
          name: 'User 1',
          focusRegions: ['/content/0', '/content/1'],
        });

        manager.register({
          actorId: 'user-2',
          actorType: 'user',
          name: 'User 2',
          focusRegions: ['/content/2', '/content/3'],
        });

        const inRegion = manager.getActorsInRegion('/content/0');
        expect(inRegion).toHaveLength(1);
        expect(inRegion[0].actorId).toBe('user-1');
      });

      it('should detect parent/child path overlaps', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({
          actorId: 'user-1',
          actorType: 'user',
          name: 'User 1',
          focusRegions: ['/content/0'],
        });

        // /content/0/props overlaps with /content/0
        const inRegion = manager.getActorsInRegion('/content/0/props');
        expect(inRegion).toHaveLength(1);
        expect(inRegion[0].actorId).toBe('user-1');
      });

      it('should return empty array when no overlap', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({
          actorId: 'user-1',
          actorType: 'user',
          name: 'User 1',
          focusRegions: ['/content/0'],
        });

        const inRegion = manager.getActorsInRegion('/content/1');
        expect(inRegion).toHaveLength(0);
      });
    });

    describe('clear', () => {
      it('should remove all presences', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });
        manager.register({ actorId: 'user-2', actorType: 'user', name: 'User 2' });

        manager.clear();

        expect(manager.count()).toBe(0);
        expect(manager.getAll()).toEqual([]);
      });
    });

    describe('toJSON', () => {
      it('should serialize presences to array', async () => {
        const { PresenceManager } = await import('../../src/services/presence-service');
        const manager = new PresenceManager();

        manager.register({ actorId: 'user-1', actorType: 'user', name: 'User 1' });
        manager.register({ actorId: 'agent-1', actorType: 'agent', name: 'Agent 1' });

        const json = manager.toJSON();
        expect(Array.isArray(json)).toBe(true);
        expect(json).toHaveLength(2);
      });
    });
  });

  describe('regionsOverlap utility', () => {
    it('should detect exact match', async () => {
      const { regionsOverlap } = await import('../../src/services/presence-service');
      expect(regionsOverlap('/content/0', '/content/0')).toBe(true);
    });

    it('should detect parent contains child', async () => {
      const { regionsOverlap } = await import('../../src/services/presence-service');
      expect(regionsOverlap('/content/0', '/content/0/props')).toBe(true);
    });

    it('should detect child is within parent', async () => {
      const { regionsOverlap } = await import('../../src/services/presence-service');
      expect(regionsOverlap('/content/0/props', '/content/0')).toBe(true);
    });

    it('should return false for non-overlapping siblings', async () => {
      const { regionsOverlap } = await import('../../src/services/presence-service');
      expect(regionsOverlap('/content/0', '/content/1')).toBe(false);
    });

    it('should return false for completely different paths', async () => {
      const { regionsOverlap } = await import('../../src/services/presence-service');
      expect(regionsOverlap('/content/0', '/header/0')).toBe(false);
    });
  });
});
