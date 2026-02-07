/**
 * Auto Merged Fields Component
 *
 * Shows non-conflicting fields that were auto-merged, with the ability
 * to override the auto-selection.
 */

import type { FieldClassification } from './types';

/** Props for the {@link AutoMergedFields} component. */
interface AutoMergedFieldsProps {
  /** Non-conflicting classified fields that were auto-merged. */
  fields: FieldClassification[];
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(removed)';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Displays non-conflicting fields that were automatically merged,
 * grouped by source-only and target-only changes.
 */
export function AutoMergedFields({
  fields,
}: AutoMergedFieldsProps) {
  if (fields.length === 0) return null;

  const sourceOnlyFields = fields.filter((f) => f.classification === 'source-only');
  const targetOnlyFields = fields.filter((f) => f.classification === 'target-only');

  return (
    <div className="auto-merged-fields">
      <div className="auto-merged-header">
        <span className="auto-merged-label">Auto-merged changes</span>
        <span className="auto-merged-count">
          {fields.length} field{fields.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="auto-merged-description">
        These changes don&apos;t conflict and can be combined safely.
      </p>

      {sourceOnlyFields.length > 0 && (
        <div className="auto-merged-group">
          <div className="auto-merged-group-label">
            Source branch changes:
          </div>
          {sourceOnlyFields.map((field) => (
            <div key={field.fieldPath} className="auto-merged-item">
              <span className="auto-merged-field-label">{field.label}:</span>
              <span className="auto-merged-value">{formatValue(field.sourceValue)}</span>
            </div>
          ))}
        </div>
      )}

      {targetOnlyFields.length > 0 && (
        <div className="auto-merged-group">
          <div className="auto-merged-group-label">
            Target branch changes:
          </div>
          {targetOnlyFields.map((field) => (
            <div key={field.fieldPath} className="auto-merged-item">
              <span className="auto-merged-field-label">{field.label}:</span>
              <span className="auto-merged-value">{formatValue(field.targetValue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
