/**
 * ViewModeSelector Component
 *
 * Toggle between view modes for the merge preview: side-by-side, overlay, and slider.
 *
 * All visual styling uses inline React styles. BEM class names are retained
 * as secondary identifiers for test assertions.
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

// =============================================================================
// Inline Style Constants
// =============================================================================

const containerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
};

const buttonBaseStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '4px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: '#d1d5db',
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
  fontSize: '13px',
};

const buttonActiveStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  background: '#2563eb',
  color: '#fff',
  borderColor: '#2563eb',
};

// =============================================================================
// Component
// =============================================================================

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
    <div className="view-mode-selector" style={containerStyle}>
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
            style={isActive ? buttonActiveStyle : buttonBaseStyle}
            onClick={() => onViewModeChange(mode)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
