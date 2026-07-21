/**
 * Field Conflict Row Component
 *
 * Shows a single conflicting field with radio buttons for resolution:
 * keep source, keep target, or write custom.
 */

import type { FieldClassification, FieldChoice } from './types';

/** Props for the {@link FieldConflictRow} component. */
interface FieldConflictRowProps {
  /** The classified field with conflict details. */
  field: FieldClassification;
  /** Display name for the source branch. */
  sourceBranchName: string;
  /** Display name for the target branch. */
  targetBranchName: string;
  /** The user's current resolution choice, or null if unresolved. */
  choice: FieldChoice | null;
  /** Callback when the user selects a resolution for this field. */
  onChoiceChange: (fieldPath: string, choice: FieldChoice) => void;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(removed)';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Displays a single conflicting field with radio buttons to choose
 * between the source branch value and the target branch value.
 */
export function FieldConflictRow({
  field,
  sourceBranchName,
  targetBranchName,
  choice,
  onChoiceChange,
}: FieldConflictRowProps) {
  return (
    <div className="field-conflict-row">
      <div className="conflict-field-label">{field.label}</div>
      <div className="conflict-options">
        <label className="conflict-option">
          <input
            type="radio"
            name={`field-${field.fieldPath}`}
            value="source"
            checked={choice === 'source'}
            onChange={() => onChoiceChange(field.fieldPath, 'source')}
          />
          <span className="option-branch-name">Keep {sourceBranchName}&apos;s version</span>
          <span className="option-value">{formatValue(field.sourceValue)}</span>
        </label>
        <label className="conflict-option">
          <input
            type="radio"
            name={`field-${field.fieldPath}`}
            value="target"
            checked={choice === 'target'}
            onChange={() => onChoiceChange(field.fieldPath, 'target')}
          />
          <span className="option-branch-name">Keep {targetBranchName}&apos;s version</span>
          <span className="option-value">{formatValue(field.targetValue)}</span>
        </label>
      </div>
    </div>
  );
}
