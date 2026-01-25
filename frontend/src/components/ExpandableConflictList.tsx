/**
 * Expandable Conflict List Component
 *
 * Displays a list of conflicts with expand/collapse functionality for viewing diffs.
 * Supports "Expand All" / "Collapse All" buttons and lazy loading of diff content.
 */

import { useState, useCallback } from 'react';
import { Button } from '@pantheon-systems/design-toolkit-react';
import type { DocumentConflict, DocumentDiff } from '../types';
import { ExpandableDiffRow } from './ExpandableDiffRow';
import './ExpandableConflictList.css';

interface ExpandableConflictListProps {
  conflicts: DocumentConflict[];
  documentDiffs?: DocumentDiff[];
  diffsLoading?: boolean;
  onRequestDiffs?: () => void;
}

export function ExpandableConflictList({
  conflicts,
  documentDiffs = [],
  diffsLoading = false,
  onRequestDiffs,
}: ExpandableConflictListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [diffsRequested, setDiffsRequested] = useState(false);

  // Find diff for a given conflict by documentId
  const getDiffForConflict = useCallback(
    (conflict: DocumentConflict): DocumentDiff | undefined => {
      return documentDiffs.find((d) => d.documentId === conflict.documentId);
    },
    [documentDiffs]
  );

  // Toggle expansion for a single row
  const handleToggle = useCallback(
    (documentId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(documentId)) {
          next.delete(documentId);
        } else {
          next.add(documentId);
          // Request diffs when first row is expanded (lazy loading)
          if (!diffsRequested && onRequestDiffs) {
            setDiffsRequested(true);
            onRequestDiffs();
          }
        }
        return next;
      });
    },
    [diffsRequested, onRequestDiffs]
  );

  // Expand all rows
  const handleExpandAll = useCallback(() => {
    // Request diffs if not already requested
    if (!diffsRequested && onRequestDiffs) {
      setDiffsRequested(true);
      onRequestDiffs();
    }
    setExpandedIds(new Set(conflicts.map((c) => c.documentId)));
  }, [conflicts, diffsRequested, onRequestDiffs]);

  // Collapse all rows
  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  if (conflicts.length === 0) {
    return (
      <div className="expandable-conflict-list-empty">
        <p>No conflicts to display.</p>
      </div>
    );
  }

  const allExpanded = expandedIds.size === conflicts.length;
  const someExpanded = expandedIds.size > 0;

  return (
    <div className="expandable-conflict-list">
      <div className="conflict-list-controls">
        <span className="conflict-count">
          {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} found
        </span>
        <div className="expand-controls">
          <Button
            type="tertiary"
            onClick={handleExpandAll}
            disabled={allExpanded || diffsLoading}
            data-testid="expand-all-diffs-btn"
          >
            Expand All
          </Button>
          <Button
            type="tertiary"
            onClick={handleCollapseAll}
            disabled={!someExpanded}
            data-testid="collapse-all-diffs-btn"
          >
            Collapse All
          </Button>
        </div>
      </div>

      <div className="conflict-rows">
        {conflicts.map((conflict) => (
          <ExpandableDiffRow
            key={conflict.documentId}
            conflict={conflict}
            diff={getDiffForConflict(conflict)}
            isExpanded={expandedIds.has(conflict.documentId)}
            onToggle={() => handleToggle(conflict.documentId)}
            isLoading={
              diffsLoading &&
              expandedIds.has(conflict.documentId) &&
              !getDiffForConflict(conflict)
            }
          />
        ))}
      </div>
    </div>
  );
}
