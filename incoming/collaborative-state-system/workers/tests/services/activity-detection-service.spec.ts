/**
 * Agent Politeness System - Phase 2.2: Activity Detection Service Tests (TDD)
 *
 * Tests for activity detection and idle timeout operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Agent Politeness Phase 2.2: Activity Detection Service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ActivityDetector', () => {
    describe('constructor', () => {
      it('should create an activity detector with default idle timeout', async () => {
        const { ActivityDetector, DEFAULT_IDLE_TIMEOUT_MS } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        expect(detector.getIdleTimeoutMs()).toBe(DEFAULT_IDLE_TIMEOUT_MS);
        expect(detector.isHumanIdle()).toBe(true);
        expect(detector.getActiveRegions()).toEqual([]);
      });

      it('should create an activity detector with custom idle timeout', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 10000 });

        expect(detector.getIdleTimeoutMs()).toBe(10000);
      });
    });

    describe('recordHumanActivity', () => {
      it('should record human activity timestamp', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        const now = Date.now();
        detector.recordHumanActivity('user-123');

        expect(detector.getLastHumanActivityAt()).toBe(now);
        expect(detector.isHumanIdle()).toBe(false);
      });

      it('should record human activity with regions', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0', '/content/1']);

        expect(detector.getActiveRegions()).toContain('/content/0');
        expect(detector.getActiveRegions()).toContain('/content/1');
      });

      it('should update timestamp on subsequent activity', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123');
        const firstTime = detector.getLastHumanActivityAt();
        expect(firstTime).toBeDefined();
        expect(typeof firstTime).toBe('number');

        vi.advanceTimersByTime(1000);
        detector.recordHumanActivity('user-123');
        const secondTime = detector.getLastHumanActivityAt();
        expect(secondTime).toBeDefined();
        expect(typeof secondTime).toBe('number');

        // Both values are confirmed to be numbers by previous assertions
        expect(secondTime).toBeGreaterThan(firstTime ?? 0);
      });

      it('should accumulate regions from multiple actors', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-1', ['/content/0']);
        detector.recordHumanActivity('user-2', ['/content/1']);

        const regions = detector.getActiveRegions();
        expect(regions).toContain('/content/0');
        expect(regions).toContain('/content/1');
      });
    });

    describe('isHumanIdle', () => {
      it('should return true when no human activity recorded', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        expect(detector.isHumanIdle()).toBe(true);
      });

      it('should return false immediately after human activity', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');

        expect(detector.isHumanIdle()).toBe(false);
      });

      it('should return true after idle timeout has passed', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');
        expect(detector.isHumanIdle()).toBe(false);

        vi.advanceTimersByTime(5001);
        expect(detector.isHumanIdle()).toBe(true);
      });

      it('should return false just before idle timeout', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');
        vi.advanceTimersByTime(4999);

        expect(detector.isHumanIdle()).toBe(false);
      });
    });

    describe('getTimeSinceLastActivity', () => {
      it('should return null when no activity recorded', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        expect(detector.getTimeSinceLastActivity()).toBeNull();
      });

      it('should return 0 immediately after activity', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123');

        expect(detector.getTimeSinceLastActivity()).toBe(0);
      });

      it('should return elapsed time since activity', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123');
        vi.advanceTimersByTime(3000);

        expect(detector.getTimeSinceLastActivity()).toBe(3000);
      });
    });

    describe('getTimeUntilIdle', () => {
      it('should return 0 when no activity recorded (already idle)', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        expect(detector.getTimeUntilIdle()).toBe(0);
      });

      it('should return full timeout immediately after activity', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');

        expect(detector.getTimeUntilIdle()).toBe(5000);
      });

      it('should return remaining time until idle', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');
        vi.advanceTimersByTime(3000);

        expect(detector.getTimeUntilIdle()).toBe(2000);
      });

      it('should return 0 after idle timeout passed', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');
        vi.advanceTimersByTime(6000);

        expect(detector.getTimeUntilIdle()).toBe(0);
      });
    });

    describe('getActiveRegions', () => {
      it('should return empty array when no regions recorded', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        expect(detector.getActiveRegions()).toEqual([]);
      });

      it('should return recorded regions', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0', '/content/1']);

        expect(detector.getActiveRegions()).toEqual(['/content/0', '/content/1']);
      });

      it('should deduplicate regions', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-1', ['/content/0']);
        detector.recordHumanActivity('user-2', ['/content/0']);

        expect(detector.getActiveRegions()).toEqual(['/content/0']);
      });

      it('should silently ignore regions beyond MAX_ACTIVE_REGIONS limit', async () => {
        const { ActivityDetector, MAX_ACTIVE_REGIONS } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        // Add MAX_ACTIVE_REGIONS regions
        const regions = Array.from(
          { length: MAX_ACTIVE_REGIONS + 100 },
          (_, i) => `/content/${String(i)}`,
        );
        detector.recordHumanActivity('user-123', regions);

        // Should cap at MAX_ACTIVE_REGIONS
        expect(detector.getActiveRegions().length).toBe(MAX_ACTIVE_REGIONS);
      });
    });

    describe('clearRegions', () => {
      it('should clear all active regions', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0', '/content/1']);
        detector.clearRegions();

        expect(detector.getActiveRegions()).toEqual([]);
      });

      it('should not affect activity timestamp', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123', ['/content/0']);
        detector.clearRegions();

        // Activity timestamp still present, so not idle yet
        expect(detector.isHumanIdle()).toBe(false);
      });
    });

    describe('isRegionActive', () => {
      it('should return false for non-active region', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        expect(detector.isRegionActive('/content/0')).toBe(false);
      });

      it('should return true for exact match', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0']);

        expect(detector.isRegionActive('/content/0')).toBe(true);
      });

      it('should return true for child of active region', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0']);

        // /content/0/props is a child of /content/0
        expect(detector.isRegionActive('/content/0/props')).toBe(true);
      });

      it('should return true for parent of active region', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0/props']);

        // /content/0 is a parent of /content/0/props
        expect(detector.isRegionActive('/content/0')).toBe(true);
      });

      it('should return false for non-overlapping region', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0']);

        expect(detector.isRegionActive('/content/1')).toBe(false);
      });
    });

    describe('getConflictingRegions', () => {
      it('should return empty array when no regions active', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        expect(detector.getConflictingRegions(['/content/0'])).toEqual([]);
      });

      it('should return overlapping regions', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0', '/content/1']);

        const conflicts = detector.getConflictingRegions(['/content/0', '/content/2']);
        expect(conflicts).toContain('/content/0');
        expect(conflicts).not.toContain('/content/2');
      });

      it('should detect parent/child conflicts', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector();

        detector.recordHumanActivity('user-123', ['/content/0']);

        const conflicts = detector.getConflictingRegions(['/content/0/props']);
        expect(conflicts).toContain('/content/0/props');
      });
    });

    describe('setIdleTimeout', () => {
      it('should update idle timeout', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.setIdleTimeout(10000);

        expect(detector.getIdleTimeoutMs()).toBe(10000);
      });

      it('should affect isHumanIdle calculation', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');
        vi.advanceTimersByTime(6000);

        expect(detector.isHumanIdle()).toBe(true);

        // Increase timeout - now should not be idle
        detector.setIdleTimeout(10000);
        expect(detector.isHumanIdle()).toBe(false);
      });
    });

    describe('reset', () => {
      it('should clear all state', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123', ['/content/0']);
        detector.reset();

        expect(detector.isHumanIdle()).toBe(true);
        expect(detector.getLastHumanActivityAt()).toBeNull();
        expect(detector.getActiveRegions()).toEqual([]);
      });

      it('should preserve idle timeout setting', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 10000 });

        detector.reset();

        expect(detector.getIdleTimeoutMs()).toBe(10000);
      });
    });

    describe('canAgentProceed', () => {
      it('should allow human-requested work immediately', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123', ['/content/0']);

        const result = detector.canAgentProceed({
          trigger: 'human_requested',
          targetRegions: ['/content/0'],
        });

        expect(result.allowed).toBe(true);
      });

      it('should deny autonomous work when humans active', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');

        const result = detector.canAgentProceed({
          trigger: 'autonomous',
          targetRegions: [],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('human_active');
        expect(result.retryAfterMs).toBe(5000);
      });

      it('should deny autonomous work with region conflicts', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123', ['/content/0']);
        vi.advanceTimersByTime(6000); // Now idle

        const result = detector.canAgentProceed({
          trigger: 'autonomous',
          targetRegions: ['/content/0'],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('region_conflict');
        expect(result.conflictingRegions).toContain('/content/0');
      });

      it('should allow autonomous work when idle and no conflicts', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123', ['/content/0']);
        vi.advanceTimersByTime(6000); // Now idle

        const result = detector.canAgentProceed({
          trigger: 'autonomous',
          targetRegions: ['/content/1'], // Different region
        });

        expect(result.allowed).toBe(true);
      });

      it('should calculate correct retryAfterMs', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123');
        vi.advanceTimersByTime(3000);

        const result = detector.canAgentProceed({
          trigger: 'autonomous',
          targetRegions: [],
        });

        expect(result.allowed).toBe(false);
        expect(result.retryAfterMs).toBe(2000);
      });
    });

    describe('toJSON', () => {
      it('should serialize state', async () => {
        const { ActivityDetector } = await import(
          '../../src/services/activity-detection-service'
        );
        const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

        detector.recordHumanActivity('user-123', ['/content/0']);

        const json = detector.toJSON();
        expect(json.idleTimeoutMs).toBe(5000);
        expect(json.lastHumanActivityAt).toBeDefined();
        expect(json.activeRegions).toContain('/content/0');
        expect(json.isIdle).toBe(false);
      });
    });
  });
});
