import React, { useLayoutEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useSidebarScrollPreservation } from '../editor/useSidebarScrollPreservation.js';

const SELECTOR = '[data-test-sidebar]';

let sidebar: HTMLElement;

beforeEach(() => {
  sidebar = document.createElement('div');
  sidebar.setAttribute('data-test-sidebar', '');
  document.body.appendChild(sidebar);
});

afterEach(() => {
  sidebar.remove();
});

/**
 * Child layout effects run before their parent's, so this reproduces the real
 * ordering: React commits a field-list rebuild that zeroes the scroll, and only
 * then does the hook get a chance to restore it.
 */
function ScrollResetter({ active }: { active: boolean }) {
  useLayoutEffect(() => {
    if (active) sidebar.scrollTop = 0;
  });
  return null;
}

function Harness({
  selector,
  resetOnCommit = false,
}: {
  selector: unknown;
  resetOnCommit?: boolean;
}) {
  useSidebarScrollPreservation(selector, SELECTOR);
  return <ScrollResetter active={resetOnCommit} />;
}

describe('useSidebarScrollPreservation', () => {
  it('restores the offset when a commit resets the sidebar to the top', () => {
    const { rerender } = render(<Harness selector={{ index: 0 }} />);
    rerender(<Harness selector={{ index: 0 }} />);

    sidebar.scrollTop = 320;
    rerender(<Harness selector={{ index: 0 }} />);
    expect(sidebar.scrollTop).toBe(320);

    rerender(<Harness selector={{ index: 0 }} resetOnCommit />);
    expect(sidebar.scrollTop).toBe(320);
  });

  it('leaves the offset alone on re-renders that did not reset the scroll', () => {
    const { rerender } = render(<Harness selector={{ index: 0 }} />);
    sidebar.scrollTop = 200;
    rerender(<Harness selector={{ index: 0 }} />);

    // Background re-render (presence, document sync) mid-scroll.
    sidebar.scrollTop = 260;
    rerender(<Harness selector={{ index: 0 }} />);

    expect(sidebar.scrollTop).toBe(260);
  });

  it('does not yank the user back when they scroll to the top themselves', () => {
    const { rerender } = render(<Harness selector={{ index: 0 }} />);
    sidebar.scrollTop = 400;
    rerender(<Harness selector={{ index: 0 }} />);

    sidebar.scrollTop = 0;
    rerender(<Harness selector={{ index: 0 }} />);

    expect(sidebar.scrollTop).toBe(0);
  });

  it('does not carry an offset across a selection change', () => {
    const { rerender } = render(<Harness selector={{ index: 0 }} />);
    sidebar.scrollTop = 280;
    rerender(<Harness selector={{ index: 0 }} />);

    rerender(<Harness selector={{ index: 4 }} resetOnCommit />);

    expect(sidebar.scrollTop).toBe(0);
  });

  it('re-baselines after a selection change so the new block keeps its own scroll', () => {
    const { rerender } = render(<Harness selector={{ index: 0 }} />);
    sidebar.scrollTop = 280;
    rerender(<Harness selector={{ index: 0 }} />);
    rerender(<Harness selector={{ index: 4 }} resetOnCommit />);

    sidebar.scrollTop = 150;
    rerender(<Harness selector={{ index: 4 }} />);
    rerender(<Harness selector={{ index: 4 }} resetOnCommit />);

    expect(sidebar.scrollTop).toBe(150);
  });

  it('is inert when no sidebar is present', () => {
    sidebar.remove();
    expect(() => {
      const { rerender } = render(<Harness selector={{ index: 0 }} />);
      rerender(<Harness selector={{ index: 0 }} />);
    }).not.toThrow();
  });
});
