/**
 * PresenceManager clearStale Tests
 *
 * Tests for the clearStale method that removes stale presence entries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PresenceManager } from '../../src/services/presence-service';
import type { ActorPresence } from '../../src/types';

describe('PresenceManager clearStale', () => {
  let manager: PresenceManager;

  beforeEach(() => {
    manager = new PresenceManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Helper to create a presence entry
   */
  function createPresence(
    actorId: string,
  ): Omit<ActorPresence, 'id' | 'lastActivityAt' | 'joinedAt'> {
    return {
      actorId,
      actorType: 'user' as const,
      role: 'human' as const,
      name: `User ${actorId}`,
      state: 'active' as const,
    };
  }

  it('should return 0 when no entries are stale', () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Register presence at current time
    manager.register(createPresence('user-1'));

    // Don't advance time, so no entries are stale
    // Clear entries older than 2 minutes (none should be cleared)
    const cleared = manager.clearStale(120000);

    expect(cleared).toBe(0);
    expect(manager.count()).toBe(1);
  });

  it('should clear entries older than maxAgeMs', () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Register presence
    manager.register(createPresence('user-1'));

    // Advance time by 3 minutes
    vi.advanceTimersByTime(180000);

    // Clear entries older than 2 minutes
    const cleared = manager.clearStale(120000);

    expect(cleared).toBe(1);
    expect(manager.count()).toBe(0);
  });

  it('should only clear stale entries, keeping fresh ones', () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Register first user
    manager.register(createPresence('old-user'));

    // Advance time by 2 minutes
    vi.advanceTimersByTime(120000);

    // Register second user (will be 2 minutes fresher)
    manager.register(createPresence('fresh-user'));

    // Advance time by another minute (old-user is now 3 min old, fresh-user is 1 min old)
    vi.advanceTimersByTime(60000);

    // Clear entries older than 2 minutes
    const cleared = manager.clearStale(120000);

    expect(cleared).toBe(1);
    expect(manager.count()).toBe(1);
    expect(manager.getByActorId('fresh-user')).not.toBeUndefined();
    expect(manager.getByActorId('old-user')).toBeUndefined();
  });

  it('should clear multiple stale entries', () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Register 3 users
    manager.register(createPresence('old-1'));
    vi.advanceTimersByTime(10000);
    manager.register(createPresence('old-2'));
    vi.advanceTimersByTime(10000);
    manager.register(createPresence('old-3'));

    // Advance time to make all 3 stale
    vi.advanceTimersByTime(180000);

    // Register 1 fresh presence
    manager.register(createPresence('fresh'));

    // Clear entries older than 2 minutes
    const cleared = manager.clearStale(120000);

    expect(cleared).toBe(3);
    expect(manager.count()).toBe(1);
    expect(manager.getByActorId('fresh')).not.toBeUndefined();
  });

  it('should clean up actorId index when clearing stale entries', () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Register presence
    manager.register(createPresence('user-1'));

    // Verify it exists
    expect(manager.getByActorId('user-1')).not.toBeUndefined();

    // Advance time by 3 minutes
    vi.advanceTimersByTime(180000);

    // Clear stale entries
    manager.clearStale(120000);

    // Verify actorId index was cleaned up
    expect(manager.getByActorId('user-1')).toBeUndefined();
  });

  it('should handle edge case of exactly maxAgeMs old entry', () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Register presence
    manager.register(createPresence('edge-user'));

    // Advance time by exactly 2 minutes
    vi.advanceTimersByTime(120000);

    // Clear entries older than 2 minutes (exactly 2 minutes should NOT be cleared)
    // now - lastActivity > maxAgeMs means 120000 > 120000 which is false
    const cleared = manager.clearStale(120000);

    expect(cleared).toBe(0);
    expect(manager.count()).toBe(1);
  });

  it('should clear entry one millisecond after maxAgeMs', () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Register presence
    manager.register(createPresence('edge-user'));

    // Advance time by 2 minutes + 1 ms
    vi.advanceTimersByTime(120001);

    // Clear entries older than 2 minutes
    const cleared = manager.clearStale(120000);

    expect(cleared).toBe(1);
    expect(manager.count()).toBe(0);
  });
});
