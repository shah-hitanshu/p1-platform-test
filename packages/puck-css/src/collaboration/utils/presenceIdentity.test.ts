/**
 * Tests for presenceIdentityKey — the dep that makes the context memo notice
 * roster changes an actor count cannot see.
 *
 * The two behaviours pull in opposite directions: the key must change for
 * anything the avatars render, and must NOT change for the high-frequency fields
 * the presence getter exists to absorb.
 */

import { describe, it, expect } from 'vitest';
import type { ActorPresence } from '@pantheon-systems/css-client';
import { presenceIdentityKey } from './presenceIdentity.js';

function actor(overrides: Partial<ActorPresence> = {}): ActorPresence {
  const id = overrides.actorId ?? 'u-1';
  return {
    id,
    actorId: id,
    actorType: 'user',
    role: 'human',
    name: 'Alice',
    state: 'active',
    lastActivityAt: '2026-08-05T00:00:00.000Z',
    joinedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('presenceIdentityKey', () => {
  it('is empty for an absent or empty roster', () => {
    expect(presenceIdentityKey(undefined)).toBe('');
    expect(presenceIdentityKey(null)).toBe('');
    expect(presenceIdentityKey([])).toBe('');
  });

  it('changes when one actor is swapped for another at the same count', () => {
    // Alice leaves and Bob joins in the same WS frame: humans.length is identical,
    // so this key is the only signal that the roster changed.
    const before = [actor({ actorId: 'u-1', name: 'Alice' })];
    const after = [actor({ actorId: 'u-2', name: 'Bob' })];

    expect(before).toHaveLength(after.length);
    expect(presenceIdentityKey(after)).not.toBe(presenceIdentityKey(before));
  });

  it('changes when a display name or avatar resolves asynchronously', () => {
    const raw = [actor({ actorId: 'u-1', name: 'u-1' })];
    const resolvedName = [actor({ actorId: 'u-1', name: 'Alice Smith' })];
    const resolvedAvatar = [
      actor({ actorId: 'u-1', name: 'Alice Smith', avatar: 'https://cdn/a.jpg' }),
    ];

    expect(presenceIdentityKey(resolvedName)).not.toBe(presenceIdentityKey(raw));
    expect(presenceIdentityKey(resolvedAvatar)).not.toBe(presenceIdentityKey(resolvedName));
  });

  it('changes when an actor goes idle, since state drives the live dot', () => {
    const active = [actor({ state: 'active' })];
    const idle = [actor({ state: 'idle' })];
    const editing = [actor({ state: 'editing' })];

    expect(presenceIdentityKey(idle)).not.toBe(presenceIdentityKey(active));
    expect(presenceIdentityKey(editing)).not.toBe(presenceIdentityKey(active));
  });

  // Agent chips render intent and the requesting human, so those have to be in
  // the key too — none of them move the actor count or the ids.
  it('changes when an agent chip field changes', () => {
    const agent = (overrides: Partial<ActorPresence> = {}) =>
      actor({ actorId: 'a-1', name: 'Agent Smith', actorType: 'agent', role: 'agent', ...overrides });

    const idleAgent = [agent()];
    const working = [agent({ intent: 'Rewriting the hero section' })];
    const reassigned = [agent({ intent: 'Rewriting the hero section', requestedById: 'u-9' })];
    const named = [
      agent({ intent: 'Rewriting the hero section', requestedById: 'u-9', requestedByName: 'Alice' }),
    ];

    expect(presenceIdentityKey(working)).not.toBe(presenceIdentityKey(idleAgent));
    expect(presenceIdentityKey(reassigned)).not.toBe(presenceIdentityKey(working));
    expect(presenceIdentityKey(named)).not.toBe(presenceIdentityKey(reassigned));
  });

  it('is stable across focus-region and activity churn', () => {
    // This is what the presence getter exists to absorb; reacting to it here would
    // recreate the context on every focus broadcast and undo that optimisation.
    // intent is deliberately NOT in this list — it is part of the key, because
    // agent chips render it. Only focusRegions/lastActivityAt/joinedAt churn.
    const base = [
      actor({
        focusRegions: ['a'],
        lastActivityAt: '2026-08-05T00:00:00.000Z',
        joinedAt: '2026-08-05T00:00:00.000Z',
      }),
    ];
    const churned = [
      actor({
        focusRegions: ['b', 'c'],
        lastActivityAt: '2026-08-05T09:41:00.000Z',
        joinedAt: '2026-08-05T08:00:00.000Z',
      }),
    ];

    expect(presenceIdentityKey(churned)).toBe(presenceIdentityKey(base));
  });

  it('distinguishes rosters that a naive delimiter would collide', () => {
    // Names are user-controlled, so the separators must not be forgeable.
    const one = [actor({ actorId: 'u-1', name: 'a|b' })];
    const two = [actor({ actorId: 'u-1', name: 'a' }), actor({ actorId: 'b' })];

    expect(presenceIdentityKey(one)).not.toBe(presenceIdentityKey(two));
  });

  it('is order-sensitive only in a way that reflects render order', () => {
    const ab = [actor({ actorId: 'u-1' }), actor({ actorId: 'u-2', name: 'Bob' })];
    const ba = [actor({ actorId: 'u-2', name: 'Bob' }), actor({ actorId: 'u-1' })];

    // The stack renders in array order and slices by maxVisible, so a reorder
    // genuinely changes what is on screen.
    expect(presenceIdentityKey(ba)).not.toBe(presenceIdentityKey(ab));
  });
});
