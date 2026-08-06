/**
 * Tests for selectHeaderCollaborators — the presence → header-avatars selector.
 *
 * The gating here is load-bearing for live updates: P1PuckProvider exposes
 * `presence` via a getter (to avoid context churn on focus-region updates) and
 * exposes hasActiveHumans/humanPresenceCount as direct values. Reading the two
 * direct values is what makes a consumer re-render on join/leave and re-invoke
 * the getter, so the selector takes them as explicit arguments.
 */

import { describe, it, expect } from 'vitest';
import type { ActorPresence } from '@pantheon-systems/css-client';
import { selectHeaderCollaborators } from './selectHeaderCollaborators.js';

function human(id: string, name: string): ActorPresence {
  return {
    id,
    actorId: id,
    actorType: 'user',
    role: 'human',
    name,
    state: 'active',
    lastActivityAt: '2026-08-05T00:00:00.000Z',
    joinedAt: '2026-08-05T00:00:00.000Z',
  };
}

const alice = human('u-1', 'Alice');
const smith: ActorPresence = { ...human('a-1', 'Agent Smith'), actorType: 'agent', role: 'agent' };

describe('selectHeaderCollaborators', () => {
  it('returns the humans currently present, never agents', () => {
    // Agents render as chips in the subheader, so they must not leak in here.
    expect(selectHeaderCollaborators({ humans: [alice], agents: [smith] }, true, 1)).toEqual([
      alice,
    ]);
  });

  it('still returns humans who are present but idle', () => {
    const idle: ActorPresence = { ...human('u-2', 'Bob'), state: 'idle' };
    expect(selectHeaderCollaborators({ humans: [idle] }, false, 1)).toEqual([idle]);
    expect(selectHeaderCollaborators({ humans: [alice, idle] }, true, 2)).toEqual([alice, idle]);
  });

  it('returns an empty list when nobody is present', () => {
    // Mid-session departure: the count is the fresher signal, so it still guards.
    expect(selectHeaderCollaborators({ humans: [alice] }, true, 0)).toEqual([]);
    expect(selectHeaderCollaborators({ humans: [] }, true, 1)).toEqual([]);
  });

  it('returns an empty list when presence is missing', () => {
    expect(selectHeaderCollaborators(null, true, 1)).toEqual([]);
    expect(selectHeaderCollaborators(undefined, true, 1)).toEqual([]);
    expect(selectHeaderCollaborators({}, true, 1)).toEqual([]);
  });
});
