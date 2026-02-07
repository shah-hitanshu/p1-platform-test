/**
 * ViewModeSelector Component
 *
 * Toggle between view modes for the merge preview: side-by-side, overlay, and slider.
 */

import React from 'react';

/**
 * Available view modes for the merge preview renderer.
 */
export type ViewMode = 'side-by-side' | 'overlay' | 'slider';

/**
 * Props for the ViewModeSelector component.
 */
export interface ViewModeSelectorProps {
  /** The currently active view mode. */
  viewMode: ViewMode;

  /** Callback when the user selects a different view mode. */
  onViewModeChange: (mode: ViewMode) => void;
}

/**
 * Button configuration for view mode options.
 */
interface ViewModeButton {
  mode: ViewMode;
  label: string;
}

const VIEW_MODE_BUTTONS: ViewModeButton[] = [
  { mode: 'side-by-side', label: 'Side by side' },
  { mode: 'overlay', label: 'Overlay' },
  { mode: 'slider', label: 'Slider' },
];

/**
 * Renders a toggle bar to switch between merge preview view modes.
 *
 * @param props - {@link ViewModeSelectorProps}
 * @returns A React element with toggle buttons for each view mode.
 *
 * @example
 * ```tsx
 * <ViewModeSelector
 *   viewMode="side-by-side"
 *   onViewModeChange={(mode) => setViewMode(mode)}
 * />
 * ```
 */
export function ViewModeSelector({
  viewMode,
  onViewModeChange,
}: ViewModeSelectorProps): React.ReactElement {
  return (
    <div className="view-mode-selector">
      {VIEW_MODE_BUTTONS.map(({ mode, label }) => {
        const isActive = viewMode === mode;
        const className = [
          'view-mode-selector__btn',
          isActive ? 'view-mode-selector__btn--active' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={mode}
            type="button"
            className={className}
            onClick={() => onViewModeChange(mode)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
