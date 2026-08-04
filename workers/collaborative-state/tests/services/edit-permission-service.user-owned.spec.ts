/**
 * Edit permission for a session owned by a signed-in person.
 *
 * A person's own claim on a region never blocks them, and a person does not
 * wait out the agent idle timeout. A region another collaborator holds still
 * denies the request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('EditPermissionService.canEdit for a person', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows a person whose only overlapping claim is their own active region', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    activityDetector.recordHumanActivity('user-1', ['/content/0']);

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'manual',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0'],
    });

    expect(result.allowed).toBe(true);
  });

  it('allows a person whose only overlapping claim is their own focus region', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    activityDetector.recordFocusActivity('user-1', ['/content/0']);

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'manual',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0'],
    });

    expect(result.allowed).toBe(true);
  });

  it('allows a person while another collaborator edits a different region', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    // Another person is mid-edit, so the idle timeout has not elapsed.
    activityDetector.recordHumanActivity('user-2', ['/content/9']);

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'manual',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0'],
    });

    expect(result.allowed).toBe(true);
  });

  it('denies a person a region another collaborator is focused on', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    activityDetector.recordFocusActivity('user-2', ['/content/0']);

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'manual',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0'],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('region_conflict');
    expect(result.conflictingRegions).toEqual(['/content/0']);
  });

  it('denies a region nested inside one another collaborator holds', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    activityDetector.recordFocusActivity('user-2', ['/content/0']);

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'manual',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0/props/title'],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('region_conflict');
  });

  it('never consults the agent registry for a person', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const getAgentStatus = vi.fn(
      (): Promise<'active' | 'suspended' | 'disabled'> => Promise.resolve('suspended'),
    );
    const service = new EditPermissionService({ activityDetector, getAgentStatus });

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'manual',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0'],
    });

    expect(result.allowed).toBe(true);
    expect(getAgentStatus).not.toHaveBeenCalled();
  });

  it('reports every conflicting region, not just the first', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    activityDetector.recordFocusActivity('user-2', ['/content/0', '/content/1']);

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'manual',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0', '/content/1', '/content/2'],
    });

    expect(result.allowed).toBe(false);
    expect(result.conflictingRegions).toEqual(['/content/0', '/content/1']);
  });

  it('allows a person who declares an autonomous trigger while they are still active', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    activityDetector.recordHumanActivity('user-1', ['/content/0']);

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'autonomous',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0'],
    });

    expect(result.allowed).toBe(true);
  });

  it('still denies a person a region another collaborator holds under an autonomous trigger', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    activityDetector.recordFocusActivity('user-2', ['/content/0']);

    const result = await service.canEdit({
      owner: { id: 'user-1', type: 'user' },
      trigger: 'autonomous',
      intent: 'Rewrite the hero copy',
      targetRegions: ['/content/0'],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('region_conflict');
  });
});

describe('EditPermissionService.canEdit idle timeout scope', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('makes an autonomous agent wait while a person is active', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector({ idleTimeoutMs: 5000 });
    const service = new EditPermissionService({ activityDetector });

    activityDetector.recordHumanActivity('user-1', ['/content/9']);

    const result = await service.canEdit({
      owner: { id: 'agent-1', type: 'agent' },
      trigger: 'autonomous',
      intent: 'Refresh the summary',
      targetRegions: ['/content/0'],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('human_active');
  });
});

describe('EditPermissionService.getConflictingRegions actor scoping', () => {
  it('omits the excluded actor\'s own regions', async () => {
    const { EditPermissionService } = await import(
      '../../src/services/edit-permission-service'
    );
    const { ActivityDetector } = await import(
      '../../src/services/activity-detection-service'
    );

    const activityDetector = new ActivityDetector();
    const service = new EditPermissionService({ activityDetector });

    service.recordHumanActivity('user-1', ['/content/0']);
    activityDetector.recordFocusActivity('user-2', ['/content/1']);

    const conflicts = service.getConflictingRegions(['/content/0', '/content/1'], {
      excludeActorId: 'user-1',
    });

    expect(conflicts).toEqual(['/content/1']);
  });
});
