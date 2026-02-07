/**
 * Field Conflict Row Component
 *
 * Shows a single conflicting field with radio buttons for resolution:
 * keep source, keep target, or write custom.
 */

import type { FieldClassification, FieldChoice } from './types';

interface FieldConflictRowProps {
  field: FieldClassification;
  sourceBranchName: string;
  targetBranchName: string;
  choice: FieldChoice | null;
  onChoiceChange: (fieldPath: string, choice: FieldChoice) => void;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(removed)';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

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
