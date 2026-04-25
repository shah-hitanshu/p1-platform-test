/**
 * ResolutionStrategyPicker Component
 *
 * Three-button toggle group for choosing a merge resolution strategy.
 * Cherry-pick is disabled for delete-type conflicts.
 */

import React from 'react';
import { SegmentedButton } from '@pantheon-systems/pds-toolkit-react';
import type { DocumentConflictType } from '@pantheon/css-client';
import type { DocumentResolutionStrategy } from '../../hooks/useMergeResolution.js';

export interface ResolutionStrategyPickerProps {
  currentStrategy: DocumentResolutionStrategy;
  conflictType: DocumentConflictType;
  onSelect: (strategy: DocumentResolutionStrategy) => void;
}

function isDeleteConflict(conflictType: DocumentConflictType): boolean {
  return conflictType === 'deleted-in-source' || conflictType === 'deleted-in-target';
}

export function ResolutionStrategyPicker({
  currentStrategy,
  conflictType,
  onSelect,
}: ResolutionStrategyPickerProps): React.ReactElement {
  const isDelete = isDeleteConflict(conflictType);

  const options = [
    { label: 'Accept Draft', value: 'accept-draft' },
    { label: 'Accept Live', value: 'accept-live' },
    { label: 'Cherry-pick', value: 'cherry-pick', disabled: isDelete },
  ];

  return (
    <SegmentedButton
      id="resolution-strategy"
      label="Resolution strategy"
      size="s"
      value={currentStrategy}
      options={options}
      onChange={(value) => onSelect(value as DocumentResolutionStrategy)}
    />
  );
}
