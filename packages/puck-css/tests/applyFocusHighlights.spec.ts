import { describe, it, expect, beforeEach } from 'vitest';
import { applyFocusHighlights } from '../src/collaboration/utils/applyFocusHighlights.js';
import type { FocusHighlight } from '../src/collaboration/utils/focusRegionMap.js';

function highlight(overrides: Partial<FocusHighlight> = {}): FocusHighlight {
  return {
    actorId: 'user-alice',
    actorName: 'alice',
    color: '#123456',
    isEditing: false,
    ...overrides,
  };
}

function blockFor(componentId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-puck-component="${componentId}"]`);
  if (!el) throw new Error(`no block rendered for ${componentId}`);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = `
    <div data-puck-component="hero-1"></div>
    <div data-puck-component="text-1"></div>
  `;
});

describe('applyFocusHighlights, applying', () => {
  it('writes the class, color and actor onto the block', () => {
    applyFocusHighlights(document, new Map([['hero-1', highlight()]]), new Set());

    const el = blockFor('hero-1');
    expect(el.classList.contains('focus-region-highlight')).toBe(true);
    expect(el.style.getPropertyValue('--focus-color')).toBe('#123456');
    expect(el.getAttribute('data-focus-actor')).toBe('user-alice');
  });

  it('uppercases the initial it shows for the actor', () => {
    applyFocusHighlights(document, new Map([['hero-1', highlight()]]), new Set());

    expect(blockFor('hero-1').getAttribute('data-focus-initial')).toBe('A');
  });

  it('marks an agent so the stylesheet can draw it as one', () => {
    applyFocusHighlights(
      document,
      new Map([
        ['hero-1', highlight({ isAgent: true })],
        ['text-1', highlight({ isAgent: false })],
      ]),
      new Set(),
    );

    expect(blockFor('hero-1').getAttribute('data-focus-role')).toBe('agent');
    expect(blockFor('text-1').hasAttribute('data-focus-role')).toBe(false);
  });

  it('drops the agent mark when a person takes the block over', () => {
    const previous = applyFocusHighlights(
      document,
      new Map([['hero-1', highlight({ isAgent: true })]]),
      new Set(),
    );

    applyFocusHighlights(document, new Map([['hero-1', highlight({ isAgent: false })]]), previous);

    expect(blockFor('hero-1').hasAttribute('data-focus-role')).toBe(false);
  });

  it('marks an editing actor and only an editing actor', () => {
    applyFocusHighlights(
      document,
      new Map([
        ['hero-1', highlight({ isEditing: true })],
        ['text-1', highlight({ isEditing: false })],
      ]),
      new Set(),
    );

    expect(blockFor('hero-1').classList.contains('focus-region-highlight--editing')).toBe(true);
    expect(blockFor('text-1').classList.contains('focus-region-highlight--editing')).toBe(false);
  });

  it('drops the editing class when the actor stops editing', () => {
    const editing = new Map([['hero-1', highlight({ isEditing: true })]]);
    const previous = applyFocusHighlights(document, editing, new Set());

    applyFocusHighlights(document, new Map([['hero-1', highlight({ isEditing: false })]]), previous);

    const el = blockFor('hero-1');
    expect(el.classList.contains('focus-region-highlight')).toBe(true);
    expect(el.classList.contains('focus-region-highlight--editing')).toBe(false);
  });
});

describe('applyFocusHighlights, clearing', () => {
  it('strips every trace from a block that has left the map', () => {
    const previous = applyFocusHighlights(
      document,
      new Map([['hero-1', highlight({ isEditing: true, isAgent: true })]]),
      new Set(),
    );

    applyFocusHighlights(document, new Map(), previous);

    const el = blockFor('hero-1');
    expect(el.classList.contains('focus-region-highlight')).toBe(false);
    expect(el.classList.contains('focus-region-highlight--editing')).toBe(false);
    expect(el.style.getPropertyValue('--focus-color')).toBe('');
    expect(el.hasAttribute('data-focus-actor')).toBe(false);
    expect(el.hasAttribute('data-focus-initial')).toBe(false);
    expect(el.hasAttribute('data-focus-role')).toBe(false);
  });

  it('leaves a block that is still held', () => {
    const previous = applyFocusHighlights(
      document,
      new Map([
        ['hero-1', highlight()],
        ['text-1', highlight()],
      ]),
      new Set(),
    );

    applyFocusHighlights(document, new Map([['hero-1', highlight()]]), previous);

    expect(blockFor('hero-1').classList.contains('focus-region-highlight')).toBe(true);
    expect(blockFor('text-1').classList.contains('focus-region-highlight')).toBe(false);
  });

  it('adds nothing to a block it is clearing', () => {
    const previous = applyFocusHighlights(document, new Map([['hero-1', highlight()]]), new Set());
    applyFocusHighlights(document, new Map(), previous);

    expect(blockFor('hero-1').children).toHaveLength(0);
  });
});

describe('applyFocusHighlights, blocks the canvas has not drawn', () => {
  it('skips an ID with no element instead of throwing', () => {
    expect(() =>
      applyFocusHighlights(document, new Map([['never-rendered', highlight()]]), new Set()),
    ).not.toThrow();
  });

  it('still reports it, so it is cleared once it has an element', () => {
    const current = applyFocusHighlights(
      document,
      new Map([['never-rendered', highlight()]]),
      new Set(),
    );

    expect(current.has('never-rendered')).toBe(true);
  });

  it('survives a block that was removed while it was highlighted', () => {
    const previous = applyFocusHighlights(document, new Map([['hero-1', highlight()]]), new Set());
    blockFor('hero-1').remove();

    expect(() => applyFocusHighlights(document, new Map(), previous)).not.toThrow();
  });
});
