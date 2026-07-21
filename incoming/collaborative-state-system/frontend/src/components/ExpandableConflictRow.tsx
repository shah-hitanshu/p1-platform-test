/**
 * Expandable Conflict Row Component
 *
 * Displays a conflict with expand/collapse functionality to show the JsonDiffViewer.
 * For both-modified conflicts, offers a "Choose field by field" option that shows
 * the FieldResolutionPanel for granular conflict resolution.
 * When "CRDT merge" is selected, shows a preview/accept/reject flow.
 */

import { useState } from 'react';
import { Button } from '@pantheon-systems/pds-toolkit-react';
import type { DocumentConflict, DocumentConflictType, ConflictResolutionStrategy, DocumentDiff } from '../types';
import { JsonDiffViewer } from './JsonDiffViewer';
import { ContentDiffViewer } from './content-diff/ContentDiffViewer';
import { FieldResolutionPanel } from './field-resolution/FieldResolutionPanel';
import { CrdtPreviewButton } from './field-resolution/CrdtPreviewButton';
import './ExpandableConflictRow.css';

interface ExpandableConflictRowProps {
  conflict: DocumentConflict;
  diff?: DocumentDiff;
  isExpanded: boolean;
  onToggle: () => void;
  resolution: ConflictResolutionStrategy;
  onResolutionChange: (strategy: ConflictResolutionStrategy) => void;
  onResolvedSnapshot?: (snapshot: Record<string, unknown>) => void;
  sourceBranchName?: string;
  targetBranchName?: string;
  disabled?: boolean;
  siteId?: string;
  sourceBranchId?: string;
  targetBranchId?: string;
}

function getConflictTypeLabel(type: DocumentConflictType): string {
  switch (type) {
    case 'both-modified':
      return 'Both modified';
    case 'deleted-in-source':
      return 'Deleted in source';
    case 'deleted-in-target':
      return 'Deleted in target';
    default:
      return type;
  }
}

function getResolutionLabel(strategy: ConflictResolutionStrategy): string {
  switch (strategy) {
    case 'take-source':
      return 'Take source';
    case 'take-target':
      return 'Take target';
    case 'merge-crdt':
      return 'CRDT merge';
    case 'manual':
      return 'Choose field by field';
    default:
      return strategy;
  }
}

const BASE_RESOLUTION_OPTIONS: ConflictResolutionStrategy[] = ['take-source', 'take-target', 'merge-crdt'];

export function ExpandableConflictRow({
  conflict,
  diff,
  isExpanded,
  onToggle,
  resolution,
  onResolutionChange,
  onResolvedSnapshot,
  sourceBranchName = 'Source',
  targetBranchName = 'Target',
  disabled = false,
  siteId,
  sourceBranchId,
  targetBranchId,
}: ExpandableConflictRowProps) {
  const [viewMode, setViewMode] = useState<'json' | 'content'>('json');
  const [crdtPreviewSnapshot, setCrdtPreviewSnapshot] = useState<Record<string, unknown> | null>(null);
  const [crdtAccepted, setCrdtAccepted] = useState(false);
  const isBothModified = conflict.conflictType === 'both-modified';
  const resolutionOptions = isBothModified
    ? [...BASE_RESOLUTION_OPTIONS, 'manual' as ConflictResolutionStrategy]
    : BASE_RESOLUTION_OPTIONS;

  const handleCrdtPreviewResult = (mergedSnapshot: Record<string, unknown>) => {
    setCrdtPreviewSnapshot(mergedSnapshot);
  };

  const handleAcceptCrdtPreview = () => {
    if (crdtPreviewSnapshot != null) {
      setCrdtAccepted(true);
      onResolutionChange('manual');
      onResolvedSnapshot?.(crdtPreviewSnapshot);
    }
  };

  const handleRejectCrdtPreview = () => {
    setCrdtPreviewSnapshot(null);
  };

  const showCrdtPreview = resolution === 'merge-crdt' && isExpanded && siteId != null && sourceBranchId != null && targetBranchId != null;

  return (
    <div className={`expandable-conflict-row ${isExpanded ? 'expanded' : ''}`}>
      <div className="conflict-row-header" onClick={onToggle} role="button" tabIndex={0}>
        <div className="conflict-row-info">
          <code className="conflict-row-path">{conflict.documentPath}</code>
          <span className="conflict-row-type">{getConflictTypeLabel(conflict.conflictType)}</span>
        </div>
        <Button
          variant="subtle"
          label={isExpanded ? 'Hide diff' : 'Show diff'}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse diff view' : 'Expand diff view'}
          data-testid={`expand-toggle-${conflict.documentId}`}
        />
      </div>

      {isExpanded && diff != null && resolution !== 'manual' && resolution !== 'merge-crdt' && (
        <div className="conflict-row-diff">
          <div className="diff-view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'json' ? 'active' : ''}`}
              onClick={() => setViewMode('json')}
              aria-label="JSON view"
            >
              JSON view
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'content' ? 'active' : ''}`}
              onClick={() => setViewMode('content')}
              aria-label="Content view"
            >
              Content view
            </button>
          </div>

          {viewMode === 'json' ? (
            <JsonDiffViewer
              sourceData={diff.sourceSnapshot}
              targetData={diff.targetSnapshot}
              diffOperations={diff.diffOperations}
              sourceLabel="Source branch"
              targetLabel="Target branch"
            />
          ) : (
            <ContentDiffViewer
              sourceData={diff.sourceSnapshot}
              targetData={diff.targetSnapshot}
              diffOperations={diff.diffOperations}
              sourceLabel="Source branch"
              targetLabel="Target branch"
            />
          )}
        </div>
      )}

      {isExpanded && diff == null && resolution !== 'manual' && resolution !== 'merge-crdt' && (
        <div className="conflict-row-no-diff">
          Diff data not available
        </div>
      )}

      {/* CRDT Preview Section */}
      {showCrdtPreview && crdtPreviewSnapshot == null && (
        <div className="crdt-preview-section">
          <CrdtPreviewButton
            siteId={siteId}
            documentId={conflict.documentId}
            sourceBranchId={sourceBranchId}
            targetBranchId={targetBranchId}
            onResult={handleCrdtPreviewResult}
          />
        </div>
      )}

      {showCrdtPreview && crdtPreviewSnapshot != null && (
        <div className="crdt-preview-section">
          <h4 className="crdt-preview-header">Auto-merge preview</h4>
          {diff != null && diff.targetSnapshot != null && (
            <ContentDiffViewer
              sourceData={diff.targetSnapshot}
              targetData={crdtPreviewSnapshot}
              diffOperations={[]}
              sourceLabel={`${targetBranchName} (current)`}
              targetLabel="Auto-merged result"
            />
          )}
          <div className="crdt-preview-actions">
            <Button
              variant="primary"
              label="Accept auto-merge"
              onClick={handleAcceptCrdtPreview}
              data-testid="accept-crdt-preview"
            />
            <Button
              variant="secondary"
              label="Reject"
              onClick={handleRejectCrdtPreview}
              data-testid="reject-crdt-preview"
            />
          </div>
        </div>
      )}

      {/* Auto-merge accepted indicator */}
      {crdtAccepted && resolution === 'manual' && (
        <div className="crdt-accepted-indicator">
          Auto-merge accepted
        </div>
      )}

      {resolution === 'manual' && !crdtAccepted && diff != null && diff.sourceSnapshot != null && diff.targetSnapshot != null && (
        <div className="conflict-row-field-resolution">
          <FieldResolutionPanel
            sourceSnapshot={diff.sourceSnapshot}
            targetSnapshot={diff.targetSnapshot}
            baseSnapshot={null}
            sourceBranchName={sourceBranchName}
            targetBranchName={targetBranchName}
            onResolve={(snapshot) => onResolvedSnapshot?.(snapshot)}
          />
        </div>
      )}

      <div className="conflict-row-resolution">
        <span className="resolution-label">Resolution:</span>
        <div className="resolution-options">
          {resolutionOptions.map((strategy) => (
            <label key={strategy} className="resolution-option">
              <input
                type="radio"
                name={`resolution-${conflict.documentId}`}
                value={strategy}
                checked={resolution === strategy}
                onChange={() => {
                  setCrdtAccepted(false);
                  setCrdtPreviewSnapshot(null);
                  onResolutionChange(strategy);
                }}
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
