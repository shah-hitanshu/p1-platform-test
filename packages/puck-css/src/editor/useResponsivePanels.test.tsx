import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  initialPanelUi,
  useResponsivePanels,
  type PanelUiAction,
  type UseResponsivePanelsArgs,
} from './useResponsivePanels.js';

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
    writable: true,
  });
}

function resizeTo(width: number): void {
  act(() => {
    setWidth(width);
    window.dispatchEvent(new Event('resize'));
  });
}

/**
 * Drives the hook the way Puck would: `dispatch` records actions, and `apply`
 * feeds the resulting visibility back in as new props on the next render.
 */
function renderPanels(overrides: Partial<UseResponsivePanelsArgs> = {}) {
  const dispatch = vi.fn<(action: PanelUiAction) => void>();
  const props: UseResponsivePanelsArgs = {
    leftVisible: true,
    rightVisible: true,
    dispatch,
    ...overrides,
  };
  const view = renderHook((p: UseResponsivePanelsArgs) => useResponsivePanels(p), {
    initialProps: props,
  });

  return {
    dispatch,
    apply(next: { left?: boolean; right?: boolean }) {
      props.leftVisible = next.left ?? props.leftVisible;
      props.rightVisible = next.right ?? props.rightVisible;
      act(() => {
        view.rerender({ ...props });
      });
    },
    uiCalls: (): PanelUiAction['ui'][] => dispatch.mock.calls.map(([action]) => action.ui),
  };
}

beforeEach(() => {
  localStorage.clear();
  setWidth(1600);
});

describe('initialPanelUi', () => {
  it('treats an absent stored preference as open', () => {
    expect(initialPanelUi()).toEqual({
      leftSideBarVisible: true,
      rightSideBarVisible: true,
    });
  });

  it('lets the budget close a panel the stored preference wanted open', () => {
    localStorage.setItem('p1-sidebar', '{"left":true,"right":true}');
    setWidth(1200);

    expect(initialPanelUi()).toEqual({
      leftSideBarVisible: false,
      rightSideBarVisible: true,
    });
  });

  it('keeps a stored preference of closed even when the width allows it', () => {
    localStorage.setItem('p1-sidebar', '{"left":true,"right":false}');

    expect(initialPanelUi()).toEqual({
      leftSideBarVisible: true,
      rightSideBarVisible: false,
    });
  });

  it.each([
    // rail 68 + left 320 + right 320 + a 600px canvas floor = 1308
    [1308, true, true],
    [1307, false, true],
    // rail 68 + right 320 + the same floor, left panel already gone = 988
    [988, false, true],
    [987, false, false],
  ])('at %ipx mounts left %s, right %s', (width, left, right) => {
    setWidth(width);

    expect(initialPanelUi()).toEqual({
      leftSideBarVisible: left,
      rightSideBarVisible: right,
    });
  });

  it('falls back to open when the stored value is not valid JSON', () => {
    localStorage.setItem('p1-sidebar', 'not json');

    expect(initialPanelUi()).toEqual({
      leftSideBarVisible: true,
      rightSideBarVisible: true,
    });
  });
});

describe('useResponsivePanels', () => {
  it('leaves both panels alone when the window fits everything', () => {
    const h = renderPanels();

    expect(h.uiCalls()).toEqual([]);
  });

  it('closes the left panel first when the window drops below the all-open budget', () => {
    const h = renderPanels();

    resizeTo(1200);

    expect(h.uiCalls()).toEqual([{ leftSideBarVisible: false }]);
  });

  it('closes the right panel once the window drops below the docked budget', () => {
    const h = renderPanels();

    resizeTo(1200);
    h.apply({ left: false });
    resizeTo(900);

    expect(h.uiCalls()).toEqual([
      { leftSideBarVisible: false },
      { rightSideBarVisible: false },
    ]);
  });

  it('reopens both panels when the window grows back', () => {
    const h = renderPanels();

    resizeTo(900);
    h.apply({ left: false, right: false });
    resizeTo(1600);

    expect(h.uiCalls().at(-1)).toEqual({
      leftSideBarVisible: true,
      rightSideBarVisible: true,
    });
  });

  it('never reopens a panel the user closed while the window was wide', () => {
    const h = renderPanels();

    h.apply({ right: false }); // user collapses the inspector at 1600px
    resizeTo(1200); // left auto-closes
    h.apply({ left: false });
    resizeTo(1600); // left must come back, right must not

    expect(h.uiCalls().at(-1)).toEqual({ leftSideBarVisible: true });
  });

  it('reopens a panel that the initial budget closed on a narrow first load', () => {
    setWidth(1200);
    // useP1Editor already applied the budget, so the panel mounts closed.
    const h = renderPanels({ leftVisible: false });

    resizeTo(1600);

    expect(h.uiCalls().at(-1)).toEqual({ leftSideBarVisible: true });
  });

  it('lets the user reopen a panel that the budget closed', () => {
    const h = renderPanels();

    resizeTo(900); // both auto-close
    h.apply({ left: false, right: false });
    h.apply({ left: true }); // user clicks the subheader toggle

    // The budget already had its say when the threshold was crossed; the
    // explicit reopen must survive.
    expect(h.uiCalls().at(-1)).not.toEqual({ leftSideBarVisible: false });
  });

  it('lets the user open a panel that mounted closed at a narrow width', () => {
    setWidth(900);
    // useP1Editor applies the budget before first paint, so both panels mount
    // closed and auto never has to dispatch anything.
    const h = renderPanels({ leftVisible: false, rightVisible: false });

    h.apply({ right: true }); // first click of the session

    expect(h.uiCalls()).toEqual([]);
  });

  it('keeps a user-reopened panel open across further narrowing', () => {
    const h = renderPanels();

    resizeTo(1200); // left auto-closes
    h.apply({ left: false });
    h.apply({ left: true }); // user reopens it
    resizeTo(1100); // narrower still, but no new threshold for the left panel

    expect(h.uiCalls()).toEqual([{ leftSideBarVisible: false }]);
  });

  it('re-applies the budget when the threshold is crossed again', () => {
    const h = renderPanels();

    resizeTo(1200); // left auto-closes
    h.apply({ left: false });
    h.apply({ left: true }); // user reopens it
    resizeTo(1600); // back above the budget
    resizeTo(1200); // and below again — a fresh crossing

    expect(h.uiCalls().at(-1)).toEqual({ leftSideBarVisible: false });
  });

  it('does not fight a resize that crosses no threshold', () => {
    const h = renderPanels();

    resizeTo(1500);
    resizeTo(1400);

    expect(h.uiCalls()).toEqual([]);
  });

  it('does not persist panel state below the all-open budget', () => {
    renderPanels();

    resizeTo(1200);

    expect(localStorage.getItem('p1-sidebar')).toBeNull();
  });

  it('persists panel state once the window is wide enough for everything', () => {
    const h = renderPanels();

    h.apply({ right: false });

    expect(localStorage.getItem('p1-sidebar')).toBe('{"left":true,"right":false}');
  });

  it('does nothing when Puck has not provided a dispatch yet', () => {
    renderPanels({ dispatch: undefined });

    expect(() => resizeTo(900)).not.toThrow();
  });
});
