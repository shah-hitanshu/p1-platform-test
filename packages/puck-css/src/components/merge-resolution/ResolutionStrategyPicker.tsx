/**
 * ResolutionStrategyPicker Component
 *
 * Four-button toggle group for choosing a merge resolution strategy.
 * Cherry-pick and CRDT merge are disabled for delete-type conflicts.
 */

import React from 'react';
import type { DocumentConflictType } from '@pantheon/css-client';
import type { DocumentResolutionStrategy } from '../../hooks/useMergeResolution.js';

export interface ResolutionStrategyPickerProps {
  currentStrategy: DocumentResolutionStrategy;
  conflictType: DocumentConflictType;
  onSelect: (strategy: DocumentResolutionStrategy) => void;
}

const baseClass = 'resolution-strategy-picker';

interface StrategyButton {
  strategy: DocumentResolutionStrategy;
  label: string;
  disabledForDelete: boolean;
}

const strategies: StrategyButton[] = [
  { strategy: 'accept-draft', label: 'Accept Draft', disabledForDelete: false },
  { strategy: 'accept-live', label: 'Accept Live', disabledForDelete: false },
  { strategy: 'cherry-pick', label: 'Cherry-pick', disabledForDelete: true },
  { strategy: 'crdt-preview', label: 'CRDT merge', disabledForDelete: true },
];

function isDeleteConflict(conflictType: DocumentConflictType): boolean {
  return conflictType === 'deleted-in-source' || conflictType === 'deleted-in-target';
}

export function ResolutionStrategyPicker({
  currentStrategy,
  conflictType,
  onSelect,
}: ResolutionStrategyPickerProps): React.ReactElement {
  const isDelete = isDeleteConflict(conflictType);

  return (
    <div className={baseClass} role="group" aria-label="Resolution strategy">
      {strategies.map(({ strategy, label, disabledForDelete }) => {
        const disabled = isDelete && disabledForDelete;
        const selected = currentStrategy === strategy;

        return (
          <button
            key={strategy}
            type="button"
            className={`${baseClass}__button ${selected ? `${baseClass}__button--selected` : ''}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelect(strategy)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
