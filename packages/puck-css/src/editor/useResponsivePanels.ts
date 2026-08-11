import { useEffect, useRef, useState } from 'react';

/**
 * Responsive panel management for the editor chrome.
 *
 * The chrome costs a fixed amount of horizontal space; whatever is left belongs
 * to the canvas. One rule governs it — the canvas never drops below CANVAS_MIN —
 * and chrome yields in priority order: the left panel first, then the right. The
 * rail never yields.
 *
 * Auto-management may reopen only a panel it closed itself. A visibility change
 * it did not dispatch is the user's choice and is never undone.
 */

interface PanelVisibility {
  left: boolean;
  right: boolean;
}

interface PanelUiState {
  leftSideBarVisible: boolean;
  rightSideBarVisible: boolean;
}

export interface PanelUiAction {
  type: 'setUi';
  ui: Partial<PanelUiState>;
}

export interface UseResponsivePanelsArgs {
  /** Current Puck `leftSideBarVisible`. */
  leftVisible: boolean;
  /** Current Puck `rightSideBarVisible`. */
  rightVisible: boolean;
  /** Puck's dispatch. Undefined until the store is ready. */
  dispatch: ((action: PanelUiAction) => void) | undefined;
}

// Measured against the running editor at 1600px, where Puck's grid resolves to
// `68px 320px 892px 320px`.
const RAIL_W = 68;
const LEFT_PANEL_W = 320;
const RIGHT_PANEL_W = 320;
const CANVAS_MIN = 600;

/** Below this the left panel can no longer afford its column. */
const ALL_OPEN_BUDGET = RAIL_W + LEFT_PANEL_W + RIGHT_PANEL_W + CANVAS_MIN; // 1308

/** Below this the right panel can no longer afford its column either. */
const DOCKED_BUDGET = RAIL_W + RIGHT_PANEL_W + CANVAS_MIN; // 988

/** localStorage is already origin-scoped and an origin serves one site. */
const STORAGE_KEY = 'p1-sidebar';

const UI_KEY = { left: 'leftSideBarVisible', right: 'rightSideBarVisible' } as const;
const SIDES = ['left', 'right'] as const;

function viewportWidth(): number {
  return typeof window === 'undefined' ? ALL_OPEN_BUDGET : window.innerWidth;
}

function panelsForWidth(width: number): PanelVisibility {
  return { left: width >= ALL_OPEN_BUDGET, right: width >= DOCKED_BUDGET };
}

function shouldPersist(width: number): boolean {
  return width >= ALL_OPEN_BUDGET;
}

function readPersisted(): Partial<PanelVisibility> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Partial<PanelVisibility> | null;
    // A hand-edited or truncated value must not crash the editor.
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writePersisted(value: PanelVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* private browsing and quota exhaustion throw; neither is worth failing over */
  }
}

export function initialPanelUi(): PanelUiState {
  const persisted = readPersisted();
  const budget = panelsForWidth(viewportWidth());
  return {
    leftSideBarVisible: (persisted.left ?? true) && budget.left,
    rightSideBarVisible: (persisted.right ?? true) && budget.right,
  };
}

/** The bookkeeping auto-management carries across renders. */
interface AutoState {
  /** Sides auto closed, and may therefore reopen. */
  autoClosed: PanelVisibility;
  /** The value auto last wrote per side; anything else observed is the user. */
  lastApplied: Partial<PanelVisibility>;
  /** Sides already acted on at the current target, so a crossing acts once. */
  enforced: PanelVisibility;
  prevTarget: PanelVisibility | null;
  prevObserved: PanelVisibility | null;
}

/**
 * Seeded from the first load: a panel the budget closed against a stored
 * preference of open is auto's to reopen. One already stored closed is not.
 */
function initialAutoState(): AutoState {
  const persisted = readPersisted();
  const budget = panelsForWidth(viewportWidth());
  return {
    autoClosed: {
      left: persisted.left !== false && !budget.left,
      right: persisted.right !== false && !budget.right,
    },
    lastApplied: {},
    enforced: { left: false, right: false },
    prevTarget: null,
    prevObserved: null,
  };
}

/** Divergence from what auto wrote is a user action; auto hands that side back. */
function releaseUserChangedSides(auto: AutoState, observed: PanelVisibility): void {
  for (const side of SIDES) {
    if (auto.lastApplied[side] !== undefined && observed[side] !== auto.lastApplied[side]) {
      auto.autoClosed[side] = false;
      auto.lastApplied[side] = undefined;
    }
  }
}

/** A threshold crossing earns auto one fresh enforcement of that side. */
function rearmOnThresholdCross(auto: AutoState, target: PanelVisibility): void {
  for (const side of SIDES) {
    if (auto.prevTarget && auto.prevTarget[side] !== target[side]) auto.enforced[side] = false;
  }
  auto.prevTarget = target;
}

/** Close what the budget can no longer afford; reopen only what auto closed. */
function budgetUi(
  auto: AutoState,
  target: PanelVisibility,
  observed: PanelVisibility,
): Partial<PanelUiState> {
  const ui: Partial<PanelUiState> = {};
  for (const side of SIDES) {
    if (!target[side]) {
      if (!observed[side]) {
        auto.enforced[side] = true;
      } else if (!auto.enforced[side]) {
        auto.enforced[side] = true;
        auto.autoClosed[side] = true;
        auto.lastApplied[side] = false;
        ui[UI_KEY[side]] = false;
      }
    } else if (!observed[side] && auto.autoClosed[side]) {
      auto.autoClosed[side] = false;
      auto.lastApplied[side] = true;
      ui[UI_KEY[side]] = true;
    }
  }
  return ui;
}

/**
 * Save only at widths where auto closes nothing, so a narrow session never
 * overwrites the wide-screen preference.
 */
function persistIfDeliberate(
  width: number,
  ui: Partial<PanelUiState>,
  observed: PanelVisibility,
  observedChanged: boolean,
): void {
  const dispatched = Object.keys(ui).length > 0;
  if (!shouldPersist(width) || (!dispatched && !observedChanged)) return;
  writePersisted({
    left: ui.leftSideBarVisible ?? observed.left,
    right: ui.rightSideBarVisible ?? observed.right,
  });
}

/**
 * Collapses the left panel then the right as the window narrows, and reopens
 * them as it widens again.
 *
 * Divergence from the last auto-dispatched value is how a user action is
 * detected, which covers every mutation path — the subheader toggles, Puck's own
 * in-panel collapse buttons, the AI panel's rail bridge — without threading a
 * flag through each handler.
 */
export function useResponsivePanels({
  leftVisible,
  rightVisible,
  dispatch,
}: UseResponsivePanelsArgs): void {
  // Hold the derived target rather than the raw width: a drag fires hundreds of
  // resize events but crosses a threshold at most twice.
  const [target, setTarget] = useState<PanelVisibility>(() => panelsForWidth(viewportWidth()));

  // The raw width, in a ref so the persistence gate can read it without
  // re-rendering on every resize event.
  const widthRef = useRef(viewportWidth());

  useEffect(() => {
    const onResize = (): void => {
      widthRef.current = window.innerWidth;
      const next = panelsForWidth(window.innerWidth);
      setTarget((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const autoRef = useRef<AutoState | null>(null);
  autoRef.current ??= initialAutoState();

  useEffect(() => {
    if (!dispatch) return;

    const auto = autoRef.current as AutoState;
    const observed: PanelVisibility = { left: leftVisible, right: rightVisible };
    // Captured before it is overwritten: a null previous means the initial
    // render, where mounting must not overwrite a stored preference.
    const prevObserved = auto.prevObserved;
    auto.prevObserved = observed;

    releaseUserChangedSides(auto, observed);
    rearmOnThresholdCross(auto, target);

    const ui = budgetUi(auto, target, observed);
    if (Object.keys(ui).length > 0) dispatch({ type: 'setUi', ui });

    persistIfDeliberate(
      widthRef.current,
      ui,
      observed,
      prevObserved !== null &&
        (prevObserved.left !== observed.left || prevObserved.right !== observed.right),
    );
  }, [target, leftVisible, rightVisible, dispatch]);
}
