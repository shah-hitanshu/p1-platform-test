/**
 * The block trigger undoes the canvas scale so it stays readable. That scale changes
 * whenever the editor lays the canvas out again, so the trigger has to follow it rather
 * than measure once.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@pantheon-systems/pds-toolkit-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
}));

import { BlockCommentTrigger } from '../../features/threads/ui/BlockCommentTrigger.js';

type ResizeCallback = () => void;

function fakeFrame(width: number) {
  const frame = document.createElement('iframe');
  Object.defineProperty(frame, 'offsetWidth', { value: 1000 });
  frame.getBoundingClientRect = () => ({ width }) as DOMRect;
  return frame;
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'frameElement', { value: null, configurable: true });
  Reflect.deleteProperty(window, 'ResizeObserver');
});

describe('BlockCommentTrigger', () => {
  it('follows the canvas scale as the frame is laid out again', () => {
    const frame = fakeFrame(500);
    Object.defineProperty(window, 'frameElement', { value: frame, configurable: true });
    let resized: ResizeCallback = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    (window as any).ResizeObserver = class {
      constructor(cb: ResizeCallback) {
        resized = cb;
      }
      observe = observe;
      disconnect = disconnect;
    };
    const block = document.createElement('div');
    block.setAttribute('data-puck-component', 'comp-1');
    document.body.append(block);

    const { container, unmount } = render(<BlockCommentTrigger blockId="comp-1" />);
    const anchor = container.firstElementChild as HTMLElement;

    expect(anchor.style.transform).toBe('scale(2)');
    expect(observe).toHaveBeenCalledWith(frame);

    frame.getBoundingClientRect = () => ({ width: 250 }) as DOMRect;
    act(() => resized());

    expect(anchor.style.transform).toBe('scale(4)');

    unmount();
    expect(disconnect).toHaveBeenCalled();
    block.remove();
  });
});
