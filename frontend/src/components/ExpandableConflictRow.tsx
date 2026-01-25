/**
 * Expandable Conflict Row Component
 *
 * Displays a conflict with expand/collapse functionality to show the JsonDiffViewer.
 */

import { Button } from '@pantheon-systems/design-toolkit-react';
import type { DocumentConflict, DocumentConflictType, ConflictResolutionStrategy, DocumentDiff } from '../types';
import { JsonDiffViewer } from './JsonDiffViewer';
import './ExpandableConflictRow.css';

interface ExpandableConflictRowProps {
  conflict: DocumentConflict;
  diff?: DocumentDiff;
  isExpanded: boolean;
  onToggle: () => void;
  resolution: ConflictResolutionStrategy;
  onResolutionChange: (strategy: ConflictResolutionStrategy) => void;
  disabled?: boolean;
}

function getConflictTypeLabel(type: DocumentConflictType): string {
  switch (type) {
    case 'both-modified':
      return 'Both Modified';
    case 'deleted-in-source':
      return 'Deleted in Source';
    case 'deleted-in-target':
      return 'Deleted in Target';
    default:
      return type;
  }
}

function getResolutionLabel(strategy: ConflictResolutionStrategy): string {
  switch (strategy) {
    case 'take-source':
      return 'Take Source';
    case 'take-target':
      return 'Take Target';
    case 'merge-crdt':
      return 'CRDT Merge';
    default:
      return strategy;
  }
}

const RESOLUTION_OPTIONS: ConflictResolutionStrategy[] = ['take-source', 'take-target', 'merge-crdt'];

export function ExpandableConflictRow({
  conflict,
  diff,
  isExpanded,
  onToggle,
  resolution,
  onResolutionChange,
  disabled = false,
}: ExpandableConflictRowProps) {
  return (
    <div className={`expandable-conflict-row ${isExpanded ? 'expanded' : ''}`}>
      <div className="conflict-row-header" onClick={onToggle} role="button" tabIndex={0}>
        <div className="conflict-row-info">
          <code className="conflict-row-path">{conflict.documentPath}</code>
          <span className="conflict-row-type">{getConflictTypeLabel(conflict.conflictType)}</span>
        </div>
        <Button
          type="tertiary"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse diff view' : 'Expand diff view'}
          data-testid={`expand-toggle-${conflict.documentId}`}
        >
          {isExpanded ? 'Hide Diff' : 'Show Diff'}
        </Button>
      </div>

      {isExpanded && diff != null && (
        <div className="conflict-row-diff">
          <JsonDiffViewer
            sourceData={diff.sourceSnapshot}
            targetData={diff.targetSnapshot}
            diffOperations={diff.diffOperations}
            sourceLabel="Source Branch"
            targetLabel="Target Branch"
          />
        </div>
      )}

      {isExpanded && diff == null && (
        <div className="conflict-row-no-diff">
          Diff data not available
        </div>
      )}

      <div className="conflict-row-resolution">
        <span className="resolution-label">Resolution:</span>
        <div className="resolution-options">
          {RESOLUTION_OPTIONS.map((strategy) => (
            <label key={strategy} className="resolution-option">
              <input
                type="radio"
                name={`resolution-${conflict.documentId}`}
                value={strategy}
                checked={resolution === strategy}
                onChange={() => onResolutionChange(strategy)}
                disabled={disabled}
              />
              <span className="option-label">{getResolutionLabel(strategy)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
