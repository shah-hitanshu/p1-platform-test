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

/** Props for the {@link FieldResolutionPanel} component. */
interface FieldResolutionPanelProps {
  /** The source branch document snapshot. */
  sourceSnapshot: Record<string, unknown>;
  /** The target branch document snapshot. */
  targetSnapshot: Record<string, unknown>;
  /** The common ancestor snapshot, or null if unavailable. */
  baseSnapshot: Record<string, unknown> | null;
  /** Display name for the source branch. */
  sourceBranchName: string;
  /** Display name for the target branch. */
  targetBranchName: string;
  /** Callback invoked with the merged snapshot when the user applies their resolution. */
  onResolve: (mergedSnapshot: Record<string, unknown>) => void;
}

/**
 * Main UI panel for field-by-field conflict resolution.
 * Shows auto-merged (non-conflicting) fields, conflicting fields with resolution radio buttons,
 * and an apply button that produces the merged snapshot.
 */
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
