import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PuckData, ActorPresence } from '@pantheon-systems/css-client';

const { ccr, presence } = vi.hoisted(() => ({
  ccr: { value: null as unknown },
  presence: { value: null as unknown },
}));

vi.mock('../src/core/P1PuckContext.js', () => ({
  useP1PuckOptional: () => ccr.value,
}));

vi.mock('../src/core/PresenceContext.js', () => ({
  useOptionalPresenceContext: () => presence.value,
}));

import { useAgentHeldBlocks } from '../src/collaboration/useAgentHeldBlocks.js';

const data: PuckData = {
  content: [
    { type: 'Hero', props: { id: 'hero-1' } },
    { type: 'Text', props: { id: 'text-1' } },
  ],
  root: { props: {} },
};

function actor(overrides: Partial<ActorPresence> = {}): ActorPresence {
  return {
    id: 'presence-1',
    actorId: 'user-alice',
    actorType: 'user',
    role: 'human',
    name: 'Alice',
    state: 'active',
    focusRegions: ['content.0'],
    lastActivityAt: '2026-09-21T00:00:00Z',
    joinedAt: '2026-09-21T00:00:00Z',
    ...overrides,
  };
}

const anAgent = (overrides: Partial<ActorPresence> = {}): ActorPresence =>
  actor({
    id: 'presence-agent',
    actorId: 'agent-1',
    actorType: 'agent',
    role: 'agent',
    name: 'Zappy',
    state: 'editing',
    ...overrides,
  });

function withPresence(actors: ActorPresence[], userId = 'user-me'): void {
  ccr.value = { safeData: data };
  presence.value = { actors, userId };
}

beforeEach(() => {
  ccr.value = null;
  presence.value = null;
});

describe('useAgentHeldBlocks', () => {
  it('names the block an agent holds', () => {
    withPresence([anAgent()]);

    const { result } = renderHook(() => useAgentHeldBlocks());

    expect([...result.current]).toEqual(['hero-1']);
  });

  it('names every block of a run', () => {
    withPresence([anAgent({ focusRegions: ['content.0', 'content.1'] })]);

    const { result } = renderHook(() => useAgentHeldBlocks());

    expect([...result.current].sort()).toEqual(['hero-1', 'text-1']);
  });

  it('leaves out a block a person is on', () => {
    withPresence([actor({ state: 'editing' })]);

    const { result } = renderHook(() => useAgentHeldBlocks());

    expect(result.current.size).toBe(0);
  });

  it('counts a block an agent holds without writing to it', () => {
    withPresence([anAgent({ state: 'active' })]);

    const { result } = renderHook(() => useAgentHeldBlocks());

    expect([...result.current]).toEqual(['hero-1']);
  });

  it('is empty when presence is switched off', () => {
    const { result } = renderHook(() => useAgentHeldBlocks());

    expect(result.current.size).toBe(0);
  });
});
