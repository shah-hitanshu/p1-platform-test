/**
 * Field Resolution Panel Component
 *
 * Main UI for field-by-field conflict resolution. Shows auto-merged fields,
 * conflicts with resolution options, and an apply button.
 */

import { useState, useMemo, useCallback } from 'react';
import { classifyFields } from './classifyFields';
import { mergeSnapshots } from './mergeSnapshots';
import { AutoMergedFields } from './AutoMergedFields';
import { FieldConflictRow } from './FieldConflictRow';
import type { FieldChoice, FieldSelection } from './types';
import './FieldResolutionPanel.css';

interface FieldResolutionPanelProps {
  sourceSnapshot: Record<string, unknown>;
  targetSnapshot: Record<string, unknown>;
  baseSnapshot: Record<string, unknown> | null;
  sourceBranchName: string;
  targetBranchName: string;
  onResolve: (mergedSnapshot: Record<string, unknown>) => void;
}

export function FieldResolutionPanel({
  sourceSnapshot,
  targetSnapshot,
  baseSnapshot,
  sourceBranchName,
  targetBranchName,
  onResolve,
}: FieldResolutionPanelProps) {
  const classifications = useMemo(
    () => classifyFields(sourceSnapshot, targetSnapshot, baseSnapshot),
    [sourceSnapshot, targetSnapshot, baseSnapshot],
  );

  const autoMergedFields = useMemo(
    () => classifications.filter((f) => f.classification !== 'conflicting'),
    [classifications],
  );

  const conflictingFields = useMemo(
    () => classifications.filter((f) => f.classification === 'conflicting'),
    [classifications],
  );

  const [choices, setChoices] = useState<Record<string, FieldChoice>>({});

  const handleChoiceChange = useCallback(
    (fieldPath: string, choice: FieldChoice) => {
      setChoices((prev) => ({ ...prev, [fieldPath]: choice }));
    },
    [],
  );

  const allConflictsResolved = conflictingFields.every(
    (f) => choices[f.fieldPath] !== undefined,
  );

  const handleApply = useCallback(() => {
    // Build selections from auto-merged fields + user choices
    const selections: FieldSelection[] = [];

    for (const field of autoMergedFields) {
      selections.push({
        fieldPath: field.fieldPath,
        choice: field.classification === 'source-only' ? 'source' : 'target',
      });
    }

    for (const field of conflictingFields) {
      const choice = choices[field.fieldPath];
      if (choice) {
        selections.push({
          fieldPath: field.fieldPath,
          choice,
        });
      }
    }

    const merged = mergeSnapshots(sourceSnapshot, targetSnapshot, selections);
    onResolve(merged);
  }, [autoMergedFields, conflictingFields, choices, sourceSnapshot, targetSnapshot, onResolve]);

  return (
    <div className="field-resolution-panel">
      <AutoMergedFields fields={autoMergedFields} />

      {conflictingFields.length > 0 && (
        <div className="conflicts-section">
          <div className="conflicts-header">
            <span className="conflicts-label">Conflicts to resolve</span>
            <span className="conflicts-count">
              {conflictingFields.length} field
              {conflictingFields.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="conflicts-description">
            Both branches changed these fields. Choose which version to keep.
          </p>

          {conflictingFields.map((field) => (
            <FieldConflictRow
              key={field.fieldPath}
              field={field}
              sourceBranchName={sourceBranchName}
              targetBranchName={targetBranchName}
              choice={choices[field.fieldPath] ?? null}
              onChoiceChange={handleChoiceChange}
            />
          ))}
        </div>
      )}

      <div className="resolution-actions">
        <button
          className="apply-resolution-button"
          disabled={!allConflictsResolved}
          onClick={handleApply}
        >
          Apply resolution
        </button>
      </div>
    </div>
  );
}
