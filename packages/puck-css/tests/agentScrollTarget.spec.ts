import { describe, it, expect, beforeEach } from 'vitest';
import { agentScrollTarget } from '../src/collaboration/utils/agentScrollTarget.js';
import type { FocusHighlight } from '../src/collaboration/utils/focusRegionMap.js';

function highlight(overrides: Partial<FocusHighlight> = {}): FocusHighlight {
  return {
    actorId: 'agent-1',
    actorName: 'Pantheon Agent',
    color: '#000000',
    isEditing: true,
    isAgent: true,
    ...overrides,
  };
}

/** Lays out blocks in the given document order and returns the document. */
function canvas(componentIds: string[]): Document {
  document.body.innerHTML = componentIds
    .map((id) => `<div data-puck-component="${id}">${id}</div>`)
    .join('');
  return document;
}

describe('agentScrollTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the only block an agent holds', () => {
    const doc = canvas(['hero-1', 'text-1']);
    const map = new Map([['text-1', highlight()]]);

    expect(agentScrollTarget(doc, map)?.getAttribute('data-puck-component')).toBe('text-1');
  });

  it('picks the topmost block, not the first reserved', () => {
    const doc = canvas(['hero-1', 'text-1', 'cta-1']);
    // Reserved bottom-up: insertion order disagrees with document order.
    const map = new Map([
      ['cta-1', highlight()],
      ['hero-1', highlight()],
    ]);

    expect(agentScrollTarget(doc, map)?.getAttribute('data-puck-component')).toBe('hero-1');
  });

  it('ignores blocks a person holds', () => {
    const doc = canvas(['hero-1', 'text-1']);
    const map = new Map([
      ['hero-1', highlight({ isAgent: false, actorId: 'user-2' })],
      ['text-1', highlight()],
    ]);

    expect(agentScrollTarget(doc, map)?.getAttribute('data-puck-component')).toBe('text-1');
  });

  it('ignores an agent that is only viewing', () => {
    const doc = canvas(['hero-1', 'text-1']);
    const map = new Map([
      ['hero-1', highlight({ isEditing: false })],
      ['text-1', highlight()],
    ]);

    expect(agentScrollTarget(doc, map)?.getAttribute('data-puck-component')).toBe('text-1');
  });

  it('returns null when no agent is editing', () => {
    const doc = canvas(['hero-1']);

    expect(agentScrollTarget(doc, new Map())).toBeNull();
  });

  it('returns null while the canvas has not drawn the reserved block', () => {
    const doc = canvas(['hero-1']);
    const map = new Map([['not-drawn-yet', highlight()]]);

    expect(agentScrollTarget(doc, map)).toBeNull();
  });
});
