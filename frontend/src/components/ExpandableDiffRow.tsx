/**
 * Expandable Diff Row Component
 *
 * A read-only expandable row that shows document diffs.
 * Unlike ExpandableConflictRow, this does not include resolution radio buttons.
 */

import { Button } from '@pantheon-systems/design-toolkit-react';
import type {
  DocumentConflict,
  DocumentConflictType,
  DocumentDiff,
} from '../types';
import { JsonDiffViewer } from './JsonDiffViewer';
import './ExpandableDiffRow.css';

interface ExpandableDiffRowProps {
  conflict: DocumentConflict;
  diff?: DocumentDiff;
  isExpanded: boolean;
  onToggle: () => void;
  isLoading?: boolean;
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

export function ExpandableDiffRow({
  conflict,
  diff,
  isExpanded,
  onToggle,
  isLoading = false,
}: ExpandableDiffRowProps) {
  return (
    <div
      className={`expandable-diff-row ${isExpanded ? 'expanded' : ''}`}
      data-testid={`expandable-diff-row-${conflict.documentId}`}
    >
      <div
        className="diff-row-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="diff-row-info">
          <code className="diff-row-path">{conflict.documentPath}</code>
          <span className="diff-row-type">
            {getConflictTypeLabel(conflict.conflictType)}
          </span>
          <span className="diff-row-versions">
            {conflict.sourceVersion !== undefined && (
              <span className="version-badge source">
                v{conflict.sourceVersion}
              </span>
            )}
            {conflict.targetVersion !== undefined && (
              <span className="version-badge target">
                v{conflict.targetVersion}
              </span>
            )}
          </span>
        </div>
        <Button
          type="tertiary"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          disabled={isLoading}
          isLoading={isLoading}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Hide diff view' : 'Show diff view'}
          data-testid={`expand-diff-toggle-${conflict.documentId}`}
        >
          {isLoading ? 'Loading...' : isExpanded ? 'Hide Diff' : 'Show Diff'}
        </Button>
      </div>

      {isExpanded && diff != null && (
        <div className="diff-row-content">
          <JsonDiffViewer
            sourceData={diff.sourceSnapshot}
            targetData={diff.targetSnapshot}
            diffOperations={diff.diffOperations}
            sourceLabel="Source Branch"
            targetLabel="Target Branch"
          />
        </div>
      )}

      {isExpanded && diff == null && !isLoading && (
        <div className="diff-row-no-data">Diff data not available</div>
      )}

      {isExpanded && isLoading && (
        <div className="diff-row-loading">
          <span className="loading-spinner" />
          <span>Loading diff...</span>
        </div>
      )}
    </div>
  );
}
