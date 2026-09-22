// @vitest-environment node
/** Only an agent's highlight names the person who asked for the work. */

import { describe, it, expect } from 'vitest';
import type { PuckData, ActorPresence } from '@pantheon-systems/css-client';
import { createFocusRegionMap } from '../src/collaboration/utils/focusRegionMap.js';

const data: PuckData = {
  content: [
    { type: 'Hero', props: { id: 'hero-1' } },
    { type: 'Text', props: { id: 'text-1' } },
  ],
  root: { props: {} },
};

function actor(overrides: Partial<ActorPresence>): ActorPresence {
  return {
    id: 'presence-1',
    actorId: 'user-alice',
    actorType: 'user',
    role: 'human',
    name: 'Alice',
    state: 'active',
    focusRegions: ['/content/0'],
    lastActivityAt: '2026-09-11T00:00:00Z',
    joinedAt: '2026-09-11T00:00:00Z',
    ...overrides,
  };
}

const anAgent = (overrides: Partial<ActorPresence> = {}): ActorPresence =>
  actor({
    id: 'presence-agent',
    actorId: 'agent-1',
    actorType: 'agent',
    role: 'agent',
    name: 'Zappy AI Assistant',
    state: 'editing',
    focusRegions: ['content.0'],
    requestedByName: 'Alice',
    ...overrides,
  });

describe('createFocusRegionMap, agent identity', () => {
  it('marks an agent highlight and carries who asked for the work', () => {
    const map = createFocusRegionMap(data, [anAgent()]);

    expect(map.get('hero-1')).toMatchObject({
      isAgent: true,
      onBehalfOf: 'Alice',
      actorName: 'Zappy',
    });
  });

  it('leaves onBehalfOf unset when the agent was not asked by anyone', () => {
    const map = createFocusRegionMap(data, [anAgent({ requestedByName: undefined })]);

    expect(map.get('hero-1')?.onBehalfOf).toBeUndefined();
  });

  it('marks a person as not an agent', () => {
    const map = createFocusRegionMap(data, [actor({})]);

    expect(map.get('hero-1')?.isAgent).toBe(false);
  });

  // A person's presence can carry requestedByName too.
  it('never puts onBehalfOf on a person', () => {
    const map = createFocusRegionMap(data, [actor({ requestedByName: 'Alice' })]);

    expect(map.get('hero-1')?.onBehalfOf).toBeUndefined();
  });
});

describe('createFocusRegionMap, color', () => {
  it('gives every agent the same black, whoever it is', () => {
    const map = createFocusRegionMap(data, [
      anAgent({ actorId: 'agent-1', focusRegions: ['content.0'] }),
      anAgent({ actorId: 'agent-2', focusRegions: ['content.1'] }),
    ]);

    expect(map.get('hero-1')?.color).toBe('#000000');
    expect(map.get('text-1')?.color).toBe('#000000');
  });

  it('keeps a per-actor hue for people', () => {
    const map = createFocusRegionMap(data, [
      actor({ actorId: 'user-alice', focusRegions: ['/content/0'] }),
      actor({ actorId: 'user-bob', focusRegions: ['/content/1'] }),
    ]);

    const alice = map.get('hero-1')?.color;
    const bob = map.get('text-1')?.color;

    expect(alice).toMatch(/^#[0-9a-f]{6}$/i);
    expect(alice).not.toBe('#000000');
    expect(alice).not.toBe(bob);
  });
});

describe('createFocusRegionMap, two actors on one block', () => {
  // Presence sends actors in any order.
  it('keeps the agent when the person is listed second', () => {
    const map = createFocusRegionMap(data, [anAgent(), actor({})]);

    expect(map.get('hero-1')).toMatchObject({ actorId: 'agent-1', isAgent: true });
  });

  it('keeps the agent when the person is listed first', () => {
    const map = createFocusRegionMap(data, [actor({}), anAgent()]);

    expect(map.get('hero-1')).toMatchObject({ actorId: 'agent-1', isAgent: true });
  });

  it('still lets a person hold a block no agent has claimed', () => {
    const map = createFocusRegionMap(data, [
      anAgent({ focusRegions: ['content.0'] }),
      actor({ focusRegions: ['/content/1'] }),
    ]);

    expect(map.get('hero-1')?.isAgent).toBe(true);
    expect(map.get('text-1')?.isAgent).toBe(false);
  });
});
