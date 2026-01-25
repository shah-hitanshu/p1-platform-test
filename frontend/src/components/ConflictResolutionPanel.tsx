/**
 * Conflict Resolution Panel Component
 *
 * Allows users to select resolution strategies for each conflict.
 */

import { useState } from 'react';
import { Button } from '@pantheon-systems/design-toolkit-react';
import type { DocumentConflict, ConflictResolutionStrategy, DocumentDiff } from '../types';
import type { ConflictResolution } from '../api/merge-requests';
import { ExpandableConflictRow } from './ExpandableConflictRow';
import './ConflictResolutionPanel.css';

interface ConflictResolutionPanelProps {
  conflicts: DocumentConflict[];
  documentDiffs?: DocumentDiff[];
  onResolve: (resolutions: ConflictResolution[]) => void;
  isResolving: boolean;
}

interface ResolutionState {
  [documentId: string]: ConflictResolutionStrategy;
}

interface ExpandedState {
  [documentId: string]: boolean;
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

export function ConflictResolutionPanel({
  conflicts,
  documentDiffs,
  onResolve,
  isResolving,
}: ConflictResolutionPanelProps) {
  const [resolutions, setResolutions] = useState<ResolutionState>(() => {
    // Initialize with 'take-source' as default for all conflicts
    const initial: ResolutionState = {};
    conflicts.forEach((conflict) => {
      initial[conflict.documentId] = 'take-source';
    });
    return initial;
  });

  const [expanded, setExpanded] = useState<ExpandedState>({});

  // Build a map for quick diff lookup
  const diffMap = new Map<string, DocumentDiff>();
  if (documentDiffs != null) {
    for (const diff of documentDiffs) {
      diffMap.set(diff.documentId, diff);
    }
  }

  const handleResolutionChange = (documentId: string, strategy: ConflictResolutionStrategy) => {
    setResolutions((prev) => ({
      ...prev,
      [documentId]: strategy,
    }));
  };

  const handleApplyToAll = (strategy: ConflictResolutionStrategy) => {
    const newResolutions: ResolutionState = {};
    conflicts.forEach((conflict) => {
      newResolutions[conflict.documentId] = strategy;
    });
    setResolutions(newResolutions);
  };

  const handleToggleExpanded = (documentId: string) => {
    setExpanded((prev) => ({
      ...prev,
      [documentId]: !prev[documentId],
    }));
  };

  const handleExpandAll = () => {
    const newExpanded: ExpandedState = {};
    conflicts.forEach((conflict) => {
      newExpanded[conflict.documentId] = true;
    });
    setExpanded(newExpanded);
  };

  const handleCollapseAll = () => {
    setExpanded({});
  };

  const hasAnyExpanded = Object.values(expanded).some(Boolean);
  const hasAllExpanded = conflicts.every((c) => expanded[c.documentId]);
  const hasDiffs = documentDiffs != null && documentDiffs.length > 0;

  const handleSubmit = () => {
    const resolutionList: ConflictResolution[] = Object.entries(resolutions).map(
      ([documentId, strategy]) => ({
        documentId,
        strategy,
      })
    );
    onResolve(resolutionList);
  };

  const allResolved = conflicts.every(
    (conflict) => resolutions[conflict.documentId] !== undefined
  );

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className="conflict-resolution-panel">
      <div className="resolution-header">
        <h3 className="resolution-title">Resolve Conflicts</h3>
        <p className="resolution-description">
          Choose how to resolve each conflict. Select a strategy for each document or apply
          the same strategy to all.
        </p>
      </div>

      <div className="apply-all-section">
        <span className="apply-all-label">Apply to all:</span>
        <div className="apply-all-buttons">
          {RESOLUTION_OPTIONS.map((strategy) => (
            <Button
              key={strategy}
              type="secondary"
              onClick={() => handleApplyToAll(strategy)}
              disabled={isResolving}
              data-testid={`apply-all-${strategy}`}
            >
              {getResolutionLabel(strategy)}
            </Button>
          ))}
        </div>
      </div>

      {hasDiffs && (
        <div className="expand-controls">
          <Button
            type="tertiary"
            onClick={handleExpandAll}
            disabled={hasAllExpanded}
            data-testid="expand-all-btn"
          >
            Expand All
          </Button>
          <Button
            type="tertiary"
            onClick={handleCollapseAll}
            disabled={!hasAnyExpanded}
            data-testid="collapse-all-btn"
          >
            Collapse All
          </Button>
        </div>
      )}

      <div className="conflict-resolutions">
        {conflicts.map((conflict) => (
          <ExpandableConflictRow
            key={conflict.documentId}
            conflict={conflict}
            diff={diffMap.get(conflict.documentId)}
            isExpanded={expanded[conflict.documentId] ?? false}
            onToggle={() => handleToggleExpanded(conflict.documentId)}
            resolution={resolutions[conflict.documentId]}
            onResolutionChange={(strategy) => handleResolutionChange(conflict.documentId, strategy)}
            disabled={isResolving}
          />
        ))}
      </div>

      <div className="resolution-actions">
        <Button
          type="primary"
          onClick={handleSubmit}
          disabled={!allResolved || isResolving}
          isLoading={isResolving}
          data-testid="apply-resolutions-btn"
        >
          {isResolving ? 'Resolving...' : 'Apply Resolutions and Merge'}
        </Button>
      </div>
    </div>
  );
}
