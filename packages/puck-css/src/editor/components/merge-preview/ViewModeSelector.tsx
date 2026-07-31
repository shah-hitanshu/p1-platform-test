import React from 'react';
import { SegmentedButton } from '@pantheon-systems/pds-toolkit-react';

export type ViewMode = 'side-by-side' | 'overlay' | 'slider';

export interface ViewModeSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const VIEW_MODE_OPTIONS = [
  { label: 'Side by side', value: 'side-by-side' },
  { label: 'Overlay', value: 'overlay' },
  { label: 'Slider', value: 'slider' },
];

export function ViewModeSelector({
  viewMode,
  onViewModeChange,
}: ViewModeSelectorProps): React.ReactElement {
  return (
    <SegmentedButton
      id="merge-preview-view-mode"
      label="View mode"
      size="s"
      value={viewMode}
      options={VIEW_MODE_OPTIONS}
      onChange={(value) => onViewModeChange(value as ViewMode)}
    />
  );
}
