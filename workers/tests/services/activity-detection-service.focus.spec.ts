/**
 * Agent Politeness System - Focus Region Tracking Tests (TDD)
 *
 * Tests for proactive focus region reporting - tracking human component
 * selection BEFORE edits to prevent race conditions with agents.
 *
 * Based on Proactive Focus Region Reporting plan.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('ActivityDetector Focus Region Tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('recordFocusActivity', () => {
    it('should record focus regions for an actor', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-123', ['/content/0']);

      expect(detector.getHumanFocusRegions()).toContain('/content/0');
    });

    it('should NOT reset idle timer when recording focus (focus is not an operation)', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

      // No human activity recorded - should be idle
      expect(detector.isHumanIdle()).toBe(true);

      // Record focus activity (just selection, not an edit)
      detector.recordFocusActivity('user-123', ['/content/0']);

      // Should still be considered idle - focus doesn't count as activity
      expect(detector.isHumanIdle()).toBe(true);
    });

    it('should track focus timestamp for expiry', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      const beforeTime = Date.now();
      detector.recordFocusActivity('user-123', ['/content/0']);

      const focusInfo = detector.getFocusInfo('user-123');
      expect(focusInfo).toBeDefined();
      expect(focusInfo?.lastUpdatedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(focusInfo?.regions).toContain('/content/0');
    });

    it('should replace existing focus regions for same actor', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-123', ['/content/0']);
      detector.recordFocusActivity('user-123', ['/content/1', '/content/2']);

      const focusInfo = detector.getFocusInfo('user-123');
      expect(focusInfo?.regions).toHaveLength(2);
      expect(focusInfo?.regions).toContain('/content/1');
      expect(focusInfo?.regions).toContain('/content/2');
      expect(focusInfo?.regions).not.toContain('/content/0');
    });

    it('should track focus regions from multiple actors', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-1', ['/content/0']);
      detector.recordFocusActivity('user-2', ['/content/1']);

      const allFocus = detector.getHumanFocusRegions();
      expect(allFocus).toContain('/content/0');
      expect(allFocus).toContain('/content/1');
    });

    it('should limit focus regions per actor to MAX_FOCUS_REGIONS_PER_ACTOR', async () => {
      const { ActivityDetector, MAX_FOCUS_REGIONS_PER_ACTOR } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      // Try to add more regions than allowed
      const regions = Array.from(
        { length: MAX_FOCUS_REGIONS_PER_ACTOR + 20 },
        (_, i) => `/content/${String(i)}`,
      );
      detector.recordFocusActivity('user-123', regions);

      const focusInfo = detector.getFocusInfo('user-123');
      expect(focusInfo?.regions.length).toBe(MAX_FOCUS_REGIONS_PER_ACTOR);
    });
  });

  describe('clearActorFocus', () => {
    it('should clear focus regions for a specific actor', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-1', ['/content/0']);
      detector.recordFocusActivity('user-2', ['/content/1']);

      detector.clearActorFocus('user-1');

      expect(detector.getFocusInfo('user-1')).toBeUndefined();
      expect(detector.getFocusInfo('user-2')).toBeDefined();
      expect(detector.getHumanFocusRegions()).not.toContain('/content/0');
      expect(detector.getHumanFocusRegions()).toContain('/content/1');
    });

    it('should be idempotent (no error clearing non-existent actor)', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      // Should not throw
      expect(() => {
        detector.clearActorFocus('non-existent');
      }).not.toThrow();
    });
  });

  describe('clearStaleFocus', () => {
    it('should clear focus older than maxAgeMs', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-1', ['/content/0']);
      vi.advanceTimersByTime(20000); // 20 seconds

      detector.recordFocusActivity('user-2', ['/content/1']);

      // Clear focus older than 15 seconds
      detector.clearStaleFocus(15000);

      expect(detector.getFocusInfo('user-1')).toBeUndefined();
      expect(detector.getFocusInfo('user-2')).toBeDefined();
    });

    it('should not clear focus younger than maxAgeMs', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-1', ['/content/0']);
      vi.advanceTimersByTime(5000); // 5 seconds

      // Clear focus older than 15 seconds - nothing should be cleared
      detector.clearStaleFocus(15000);

      expect(detector.getFocusInfo('user-1')).toBeDefined();
    });
  });

  describe('getHumanFocusRegions', () => {
    it('should return empty array when no focus recorded', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      expect(detector.getHumanFocusRegions()).toEqual([]);
    });

    it('should return all focus regions from all actors', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-1', ['/content/0', '/content/1']);
      detector.recordFocusActivity('user-2', ['/content/2']);

      const regions = detector.getHumanFocusRegions();
      expect(regions).toHaveLength(3);
      expect(regions).toContain('/content/0');
      expect(regions).toContain('/content/1');
      expect(regions).toContain('/content/2');
    });

    it('should deduplicate overlapping regions', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      // Two users focus on the same region
      detector.recordFocusActivity('user-1', ['/content/0']);
      detector.recordFocusActivity('user-2', ['/content/0']);

      const regions = detector.getHumanFocusRegions();
      expect(regions).toHaveLength(1);
      expect(regions).toContain('/content/0');
    });
  });

  describe('getAllFocusedRegions', () => {
    it('should combine active regions and focus regions', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      // Record human activity (creates active regions)
      detector.recordHumanActivity('user-1', ['/content/0']);

      // Record focus activity (creates focus regions)
      detector.recordFocusActivity('user-2', ['/content/1']);

      const allRegions = detector.getAllFocusedRegions();
      expect(allRegions).toContain('/content/0');
      expect(allRegions).toContain('/content/1');
    });

    it('should deduplicate regions from both sources', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      // Same region in both active and focus
      detector.recordHumanActivity('user-1', ['/content/0']);
      detector.recordFocusActivity('user-2', ['/content/0']);

      const allRegions = detector.getAllFocusedRegions();
      expect(allRegions).toHaveLength(1);
      expect(allRegions).toContain('/content/0');
    });
  });

  describe('canAgentProceed with focus regions', () => {
    it('should deny autonomous work when targeting human focus region', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

      // User focuses on a region (but no activity - idle)
      detector.recordFocusActivity('user-123', ['/content/0']);

      const result = detector.canAgentProceed({
        trigger: 'autonomous',
        targetRegions: ['/content/0'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('region_conflict');
      expect(result.conflictingRegions).toContain('/content/0');
    });

    it('should allow autonomous work on non-focused regions', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

      // User focuses on a different region
      detector.recordFocusActivity('user-123', ['/content/0']);

      const result = detector.canAgentProceed({
        trigger: 'autonomous',
        targetRegions: ['/content/1'],
      });

      expect(result.allowed).toBe(true);
    });

    it('should detect focus region parent/child conflicts', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

      // User focuses on parent region
      detector.recordFocusActivity('user-123', ['/content/0']);

      const result = detector.canAgentProceed({
        trigger: 'autonomous',
        targetRegions: ['/content/0/props'], // Child of focused region
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('region_conflict');
    });

    it('should allow human-requested work even on focused regions', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

      // User focuses on a region
      detector.recordFocusActivity('user-123', ['/content/0']);

      const result = detector.canAgentProceed({
        trigger: 'human_requested',
        targetRegions: ['/content/0'],
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('getConflictingRegions with focus', () => {
    it('should include focus regions in conflict detection', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-123', ['/content/0']);

      const conflicts = detector.getConflictingRegions(['/content/0', '/content/1']);
      expect(conflicts).toContain('/content/0');
      expect(conflicts).not.toContain('/content/1');
    });

    it('should combine active and focus region conflicts', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      // Active region from edit
      detector.recordHumanActivity('user-1', ['/content/0']);
      // Focus region from selection
      detector.recordFocusActivity('user-2', ['/content/1']);

      const conflicts = detector.getConflictingRegions(['/content/0', '/content/1', '/content/2']);
      expect(conflicts).toContain('/content/0');
      expect(conflicts).toContain('/content/1');
      expect(conflicts).not.toContain('/content/2');
    });
  });

  describe('toJSON with focus regions', () => {
    it('should include focus regions in serialized state', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector({ idleTimeoutMs: 5000 });

      detector.recordFocusActivity('user-123', ['/content/0']);

      const json = detector.toJSON();
      expect(json.humanFocusRegions).toBeDefined();
      expect(json.humanFocusRegions).toContain('/content/0');
    });
  });

  describe('reset with focus regions', () => {
    it('should clear focus regions on reset', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-123', ['/content/0']);
      detector.reset();

      expect(detector.getHumanFocusRegions()).toEqual([]);
    });
  });
});
