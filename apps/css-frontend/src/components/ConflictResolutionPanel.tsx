/**
 * Conflict Resolution Panel Component
 *
 * Allows users to select resolution strategies for each conflict.
 * Supports manual field-by-field resolution with resolvedSnapshot.
 */

import { useState } from 'react';
import { Button } from '@pantheon-systems/pds-toolkit-react';
import type { DocumentConflict, ConflictResolutionStrategy, DocumentDiff } from '../types';
import type { ConflictResolution } from '../api/merge-requests';
import { ExpandableConflictRow } from './ExpandableConflictRow';
import './ConflictResolutionPanel.css';

interface ConflictResolutionPanelProps {
  conflicts: DocumentConflict[];
  documentDiffs?: DocumentDiff[];
  onResolve: (resolutions: ConflictResolution[]) => void;
  isResolving: boolean;
  sourceBranchName?: string;
  targetBranchName?: string;
  siteId?: string;
  sourceBranchId?: string;
  targetBranchId?: string;
}

interface ResolutionState {
  [documentId: string]: ConflictResolutionStrategy;
}

interface ResolvedSnapshotState {
  [documentId: string]: Record<string, unknown>;
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
    case 'manual':
      return 'Choose field by field';
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
  sourceBranchName = 'Source',
  targetBranchName = 'Target',
  siteId,
  sourceBranchId,
  targetBranchId,
}: ConflictResolutionPanelProps) {
  const [resolutions, setResolutions] = useState<ResolutionState>(() => {
    // Initialize with 'take-source' as default for all conflicts
    const initial: ResolutionState = {};
    conflicts.forEach((conflict) => {
      initial[conflict.documentId] = 'take-source';
    });
    return initial;
  });

  const [resolvedSnapshots, setResolvedSnapshots] = useState<ResolvedSnapshotState>({});
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

  const handleResolvedSnapshot = (documentId: string, snapshot: Record<string, unknown>) => {
    setResolvedSnapshots((prev) => ({
      ...prev,
      [documentId]: snapshot,
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
      ([documentId, strategy]) => {
        const resolution: ConflictResolution = { documentId, strategy };
        if (strategy === 'manual' && resolvedSnapshots[documentId]) {
          resolution.resolvedSnapshot = resolvedSnapshots[documentId];
        }
        return resolution;
      }
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
              variant="secondary"
              label={getResolutionLabel(strategy)}
              onClick={() => handleApplyToAll(strategy)}
              disabled={isResolving}
              data-testid={`apply-all-${strategy}`}
            />
          ))}
        </div>
      </div>

      {hasDiffs && (
        <div className="expand-controls">
          <Button
            variant="subtle"
            label="Expand All"
            onClick={handleExpandAll}
            disabled={hasAllExpanded}
            data-testid="expand-all-btn"
          />
          <Button
            variant="subtle"
            label="Collapse All"
            onClick={handleCollapseAll}
            disabled={!hasAnyExpanded}
            data-testid="collapse-all-btn"
          />
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
            onResolvedSnapshot={(snapshot) => handleResolvedSnapshot(conflict.documentId, snapshot)}
            sourceBranchName={sourceBranchName}
            targetBranchName={targetBranchName}
            disabled={isResolving}
            siteId={siteId}
            sourceBranchId={sourceBranchId}
            targetBranchId={targetBranchId}
          />
        ))}
      </div>

      <div className="resolution-actions">
        <Button
          variant="primary"
          label={isResolving ? 'Resolving...' : 'Apply Resolutions and Merge'}
          onClick={handleSubmit}
          disabled={!allResolved || isResolving}
          isLoading={isResolving}
          data-testid="apply-resolutions-btn"
        />
      </div>
    </div>
  );
}
