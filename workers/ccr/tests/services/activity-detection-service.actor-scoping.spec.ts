/**
 * Actor-scoped conflict detection.
 *
 * An actor holding a region must not see its own claim reported back as a
 * conflict, so conflict lookups accept an actor to exclude. Regions claimed by
 * anyone else still conflict.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('ActivityDetector actor-scoped conflicts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getConflictingRegions with excludeActorId', () => {
    it('omits an active region claimed only by the excluded actor', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordHumanActivity('user-1', ['/content/0']);

      const conflicts = detector.getConflictingRegions(['/content/0'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual([]);
    });

    it('reports an active region another actor also claimed', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordHumanActivity('user-1', ['/content/0']);
      detector.recordHumanActivity('user-2', ['/content/0']);

      const conflicts = detector.getConflictingRegions(['/content/0'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual(['/content/0']);
    });

    it('reports an active region claimed by a different actor', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordHumanActivity('user-2', ['/content/0']);

      const conflicts = detector.getConflictingRegions(['/content/0'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual(['/content/0']);
    });

    it('omits a focus region held only by the excluded actor', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-1', ['/content/0']);

      const conflicts = detector.getConflictingRegions(['/content/0'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual([]);
    });

    it('reports a focus region held by a different actor', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-2', ['/content/0']);

      const conflicts = detector.getConflictingRegions(['/content/0'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual(['/content/0']);
    });

    it('excludes a parent region the excluded actor claimed', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-1', ['/content/0']);

      const conflicts = detector.getConflictingRegions(['/content/0/props/title'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual([]);
    });

    it('reports a parent region a different actor claimed', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-2', ['/content/0']);

      const conflicts = detector.getConflictingRegions(['/content/0/props/title'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual(['/content/0/props/title']);
    });

    it('separates two actors each holding their own region', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordHumanActivity('user-1', ['/content/0']);
      detector.recordHumanActivity('user-2', ['/content/1']);

      const conflicts = detector.getConflictingRegions(['/content/0', '/content/1'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual(['/content/1']);
    });

    it('reports nothing once active regions are cleared', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordHumanActivity('user-2', ['/content/0']);
      detector.clearRegions();

      const conflicts = detector.getConflictingRegions(['/content/0'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual([]);
    });

    it('reports nothing for the excluded actor after reset', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordHumanActivity('user-2', ['/content/0']);
      detector.recordFocusActivity('user-2', ['/content/1']);
      detector.reset();

      const conflicts = detector.getConflictingRegions(['/content/0', '/content/1'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual([]);
    });

    it('stops treating a region as the excluded actor\'s once their focus is cleared', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordFocusActivity('user-1', ['/content/0']);
      detector.recordFocusActivity('user-2', ['/content/0']);
      detector.clearActorFocus('user-2');

      const conflicts = detector.getConflictingRegions(['/content/0'], {
        excludeActorId: 'user-1',
      });

      expect(conflicts).toEqual([]);
    });
  });

  describe('getConflictingRegions without an excluded actor', () => {
    it('reports a region the caller itself claimed', async () => {
      const { ActivityDetector } = await import(
        '../../src/services/activity-detection-service'
      );
      const detector = new ActivityDetector();

      detector.recordHumanActivity('user-1', ['/content/0']);
      detector.recordFocusActivity('user-1', ['/content/1']);

      const conflicts = detector.getConflictingRegions(['/content/0', '/content/1']);

      expect(conflicts).toEqual(['/content/0', '/content/1']);
    });
  });
});
