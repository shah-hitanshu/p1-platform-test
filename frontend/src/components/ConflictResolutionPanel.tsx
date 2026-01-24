/**
 * Conflict Resolution Panel Component
 *
 * Allows users to select resolution strategies for each conflict.
 */

import { useState } from 'react';
import type { DocumentConflict, DocumentConflictType, ConflictResolutionStrategy } from '../types';
import type { ConflictResolution } from '../api/merge-requests';
import './ConflictResolutionPanel.css';

interface ConflictResolutionPanelProps {
  conflicts: DocumentConflict[];
  onResolve: (resolutions: ConflictResolution[]) => void;
  isResolving: boolean;
}

interface ResolutionState {
  [documentId: string]: ConflictResolutionStrategy;
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

export function ConflictResolutionPanel({
  conflicts,
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
            <button
              key={strategy}
              className="apply-all-btn"
              onClick={() => handleApplyToAll(strategy)}
              disabled={isResolving}
            >
              {getResolutionLabel(strategy)}
            </button>
          ))}
        </div>
      </div>

      <div className="conflict-resolutions">
        {conflicts.map((conflict) => (
          <div key={conflict.documentId} className="resolution-item">
            <div className="resolution-item-header">
              <code className="resolution-path">{conflict.documentPath}</code>
              <span className="resolution-type">{getConflictTypeLabel(conflict.conflictType)}</span>
            </div>
            <div className="resolution-options">
              {RESOLUTION_OPTIONS.map((strategy) => (
                <label key={strategy} className="resolution-option">
                  <input
                    type="radio"
                    name={`resolution-${conflict.documentId}`}
                    value={strategy}
                    checked={resolutions[conflict.documentId] === strategy}
                    onChange={() => handleResolutionChange(conflict.documentId, strategy)}
                    disabled={isResolving}
                  />
                  <span className="option-label">{getResolutionLabel(strategy)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="resolution-actions">
        <button
          className="resolve-btn"
          onClick={handleSubmit}
          disabled={!allResolved || isResolving}
        >
          {isResolving ? 'Resolving...' : 'Apply Resolutions and Merge'}
        </button>
      </div>
    </div>
  );
}
