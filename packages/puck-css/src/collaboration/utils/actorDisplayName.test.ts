import { describe, it, expect } from 'vitest';
import type { ActorPresence } from '@pantheon-systems/css-client';
import { actorDisplayName, AGENT_DISPLAY_NAME } from './actorDisplayName.js';

function actor(overrides: Partial<ActorPresence>): ActorPresence {
  return {
    actorId: 'a-1',
    name: 'Zappy AI Assistant',
    role: 'agent',
    state: 'editing',
    ...overrides,
  } as ActorPresence;
}

describe('actorDisplayName', () => {
  it('names every agent for the product, not the registry', () => {
    expect(actorDisplayName(actor({ name: 'Zappy AI Assistant' }))).toBe(AGENT_DISPLAY_NAME);
    expect(actorDisplayName(actor({ name: 'Helper Bot' }))).toBe(AGENT_DISPLAY_NAME);
  });

  it('leaves a person their own name', () => {
    expect(actorDisplayName(actor({ role: 'human', name: 'Alice Developer' }))).toBe(
      'Alice Developer',
    );
  });
});
