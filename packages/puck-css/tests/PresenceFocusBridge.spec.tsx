/** The page changes on every keystroke and hover, so with no agent it must cost nothing. */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { PuckData } from '@pantheon-systems/css-client';

const { ccr, presence } = vi.hoisted(() => ({
  ccr: { value: null as unknown },
  presence: { value: null as unknown },
}));

vi.mock('../src/core/P1PuckContext.js', () => ({
  useP1Puck: () => ccr.value,
}));

vi.mock('../src/core/PresenceContext.js', () => ({
  useOptionalPresenceContext: () => presence.value,
}));

import { PresenceFocusBridge } from '../src/collaboration/PresenceFocusBridge.js';

const data: PuckData = {
  content: [{ type: 'Text', props: { id: 'text-1' } }],
  root: { props: {} },
};

/** Mutation records are delivered after the current task. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

// The bridge finds the canvas by id, so a frame left behind by a failing test is
// the one the next test would measure.
afterEach(() => {
  document.querySelectorAll('#preview-frame').forEach((frame) => {
    frame.remove();
  });
});

describe('PresenceFocusBridge, with no agent on the page', () => {
  it('measures nothing when the page changes', async () => {
    ccr.value = { safeData: data, stopAgent: vi.fn() };
    presence.value = { actors: [], userId: 'user-me' };
    render(
      <PresenceFocusBridge userId="user-me">
        <div data-puck-component="text-1">before</div>
      </PresenceFocusBridge>,
    );
    await settle();
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect');

    document.querySelector('[data-puck-component="text-1"]')?.append(' after');
    await settle();

    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
  });
});

// The editor replaces the canvas's document as it starts up, and again when it
// rebuilds the frame for a new viewport.
describe('PresenceFocusBridge, when the editor replaces the canvas', () => {
  const agentOnFirstBlock = {
    id: 'presence-agent',
    actorId: 'agent-1',
    actorType: 'agent',
    role: 'agent',
    name: 'Content Agent',
    state: 'editing',
    focusRegions: ['content.0'],
    lastActivityAt: '2026-09-22T00:00:00Z',
    joinedAt: '2026-09-22T00:00:00Z',
  };

  function canvas(): HTMLIFrameElement {
    const frame = document.createElement('iframe');
    frame.id = 'preview-frame';
    document.body.appendChild(frame);
    frame.contentDocument!.body.innerHTML = '<div data-puck-component="text-1"></div>';
    return frame;
  }

  it('draws the agent into the canvas that replaced the first', async () => {
    ccr.value = { safeData: data, stopAgent: vi.fn() };
    presence.value = { actors: [agentOnFirstBlock], userId: 'user-me' };
    const first = canvas();
    render(<PresenceFocusBridge userId="user-me">{null}</PresenceFocusBridge>);
    await settle();

    first.remove();
    const next = canvas();
    await act(async () => {
      next.dispatchEvent(new Event('load'));
      await settle();
    });

    const page = next.contentDocument!;
    expect(page.querySelector('[data-puck-component="text-1"]')?.getAttribute('data-focus-role')).toBe(
      'agent',
    );
    expect(page.querySelectorAll('.focus-region-agent-host')).toHaveLength(1);
    next.remove();
  });
});

// Typing anywhere on the page mutates it, and the pass reads a rect off every
// block in the run.
describe('PresenceFocusBridge, re-laying out the page', () => {
  const twoBlocks: PuckData = {
    content: [
      { type: 'Text', props: { id: 'text-1' } },
      { type: 'Text', props: { id: 'text-2' } },
    ],
    root: { props: {} },
  };

  it('keeps the layout pass out of the mutation callback', async () => {
    const frame = document.createElement('iframe');
    frame.id = 'preview-frame';
    document.body.appendChild(frame);
    const page = frame.contentDocument!;
    page.body.innerHTML =
      '<div data-puck-component="text-1">a</div><div data-puck-component="text-2">b</div>';

    ccr.value = { safeData: twoBlocks, stopAgent: vi.fn() };
    presence.value = {
      actors: [
        {
          id: 'presence-agent',
          actorId: 'agent-1',
          actorType: 'agent',
          role: 'agent',
          name: 'Content Agent',
          state: 'editing',
          focusRegions: ['content.0'],
          lastActivityAt: '2026-09-22T00:00:00Z',
          joinedAt: '2026-09-22T00:00:00Z',
        },
      ],
      userId: 'user-me',
    };
    render(<PresenceFocusBridge userId="user-me">{null}</PresenceFocusBridge>);
    await act(async () => {
      frame.dispatchEvent(new Event('load'));
      await settle();
    });
    expect(page.querySelectorAll('.focus-region-agent-host')).toHaveLength(1);

    // The canvas is its own realm, so the outer prototype would see nothing.
    const canvasElement = (frame.contentWindow as unknown as { Element: typeof Element }).Element;
    const measure = vi.spyOn(canvasElement.prototype, 'getBoundingClientRect');

    page.querySelector('[data-puck-component="text-2"]')!.firstChild!.nodeValue = 'typed';
    await settle();
    expect(measure, 'measured inside the mutation callback').not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve(null));
      });
      await settle();
    });
    expect(measure, 'never measured at all').toHaveBeenCalled();

    measure.mockRestore();
    frame.remove();
  });
});

describe('PresenceFocusBridge, following the agent to its block', () => {
  const editing = {
    id: 'presence-agent',
    actorId: 'agent-1',
    actorType: 'agent',
    role: 'agent',
    name: 'Content Agent',
    state: 'editing',
    focusRegions: ['content.0'],
    lastActivityAt: '2026-09-22T00:00:00Z',
    joinedAt: '2026-09-22T00:00:00Z',
  };

  /** Returns the spy standing in for the one block's scrollIntoView. */
  function pageWithOneBlock(frame: HTMLIFrameElement): ReturnType<typeof vi.fn> {
    frame.id = 'preview-frame';
    document.body.appendChild(frame);
    frame.contentDocument!.body.innerHTML = '<div data-puck-component="text-1"></div>';
    const block = frame.contentDocument!.querySelector<HTMLElement>('[data-puck-component]')!;
    const scroll = vi.fn();
    block.scrollIntoView = scroll;
    return scroll;
  }

  async function presenceBecomes(
    actors: unknown[],
    rerender: () => void,
  ): Promise<void> {
    presence.value = { actors, userId: 'user-me' };
    await act(async () => {
      rerender();
      await settle();
    });
  }

  it('scrolls back to a block a later turn picks up again', async () => {
    const frame = document.createElement('iframe');
    const scroll = pageWithOneBlock(frame);
    ccr.value = { safeData: data, stopAgent: vi.fn() };
    presence.value = { actors: [{ ...editing, turnId: 'turn-1' }], userId: 'user-me' };
    const view = render(<PresenceFocusBridge userId="user-me">{null}</PresenceFocusBridge>);
    await act(async () => {
      await settle();
    });
    expect(scroll).toHaveBeenCalledTimes(1);

    const rerender = (): void => {
      view.rerender(<PresenceFocusBridge userId="user-me">{null}</PresenceFocusBridge>);
    };
    // The agent releases the block, then a second turn reserves it again.
    await presenceBecomes([], rerender);
    await presenceBecomes([{ ...editing, turnId: 'turn-2' }], rerender);

    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('leaves a reader alone while one turn keeps working the same block', async () => {
    const frame = document.createElement('iframe');
    const scroll = pageWithOneBlock(frame);
    ccr.value = { safeData: data, stopAgent: vi.fn() };
    presence.value = { actors: [{ ...editing, turnId: 'turn-1' }], userId: 'user-me' };
    const view = render(<PresenceFocusBridge userId="user-me">{null}</PresenceFocusBridge>);
    await act(async () => {
      await settle();
    });
    expect(scroll).toHaveBeenCalledTimes(1);

    const rerender = (): void => {
      view.rerender(<PresenceFocusBridge userId="user-me">{null}</PresenceFocusBridge>);
    };
    await presenceBecomes([{ ...editing, turnId: 'turn-1', intent: 'second edit' }], rerender);

    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
