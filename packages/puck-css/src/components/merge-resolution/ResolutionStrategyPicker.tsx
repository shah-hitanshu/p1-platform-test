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
  /** Whether CRDT state is available. When false, the CRDT merge button is hidden. */
  hasCrdtState?: boolean;
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
  hasCrdtState = true,
}: ResolutionStrategyPickerProps): React.ReactElement {
  const isDelete = isDeleteConflict(conflictType);

  return (
    <div
      className={baseClass}
      role="group"
      aria-label="Resolution strategy"
      style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}
    >
      {strategies
        .filter(({ strategy }) => strategy !== 'crdt-preview' || hasCrdtState)
        .map(({ strategy, label, disabledForDelete }) => {
        const disabled = isDelete && disabledForDelete;
        const selected = currentStrategy === strategy;

        const buttonStyle: React.CSSProperties = {
          padding: '8px 16px',
          borderRadius: '6px',
          border: '2px solid #ccc',
          background: 'white',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 500,
          transition: 'all 0.15s',
          ...(selected && {
            borderColor: '#0066cc',
            background: '#e8f4fd',
            color: '#0066cc',
            fontWeight: 600,
          }),
          ...(disabled && {
            opacity: 0.4,
            cursor: 'not-allowed',
          }),
        };

        return (
          <button
            key={strategy}
            type="button"
            className={`${baseClass}__button ${selected ? `${baseClass}__button--selected` : ''}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelect(strategy)}
            style={buttonStyle}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
