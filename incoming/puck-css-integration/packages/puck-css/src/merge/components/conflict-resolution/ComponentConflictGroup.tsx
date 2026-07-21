/**
 * ComponentConflictGroup Component
 *
 * Displays conflicts for a single Puck component, showing each conflicting
 * prop with source and target values and radio buttons for resolution.
 *
 * All visual styling uses inline React styles. BEM class names are retained
 * as secondary identifiers for test assertions.
 */

import React from 'react';
import type { PuckFieldClassification } from '../../utils/puckFieldClassifier.js';

/**
 * Props for the ComponentConflictGroup component.
 */
export interface ComponentConflictGroupProps {
  /** The Puck component type name (e.g. "Heading", "Text") */
  componentType: string;
  /** The Puck component ID */
  componentId: string;
  /** Classified fields for this component */
  fields: PuckFieldClassification[];
  /** Display name of the source branch */
  sourceBranchName: string;
  /** Display name of the target branch */
  targetBranchName: string;
  /** Current resolution choices keyed by propName */
  resolutions: Record<string, 'source' | 'target'>;
  /** Callback when a resolution radio is selected */
  onResolutionChange: (
    componentId: string,
    propName: string,
    choice: 'source' | 'target'
  ) => void;
}

const baseClass = 'component-conflict-group';

// =============================================================================
// Inline Style Constants
// =============================================================================

const containerStyle: React.CSSProperties = {
  marginBottom: '16px',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '8px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  margin: 0,
};

const conflictCountStyle: React.CSSProperties = {
  fontSize: '12px',
  padding: '2px 8px',
  borderRadius: '10px',
  background: '#fef3c7',
  color: '#92400e',
};

const fieldsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const fieldRowStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
};

const fieldNameStyle: React.CSSProperties = {
  fontWeight: 500,
  fontSize: '13px',
  marginBottom: '4px',
};

const fieldValuesStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const optionLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  cursor: 'pointer',
};

const branchNameStyle: React.CSSProperties = {
  fontWeight: 500,
  color: '#374151',
};

const valueStyle: React.CSSProperties = {
  color: '#6b7280',
  fontFamily: 'monospace',
  fontSize: '12px',
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Formats a value for display. Objects and arrays are JSON-stringified;
 * primitives are converted to string directly.
 */
function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// =============================================================================
// Component
// =============================================================================

/**
 * Renders a group of conflicting fields for a single Puck component.
 *
 * Shows the component type as a header, a conflict count badge, and
 * for each field: the prop name, source/target values, and radio
 * buttons to choose which side to keep.
 *
 * @param props - {@link ComponentConflictGroupProps}
 * @returns A React element displaying the conflict group with resolution controls.
 *
 * @example
 * ```tsx
 * <ComponentConflictGroup
 *   componentType="Heading"
 *   componentId="h1"
 *   fields={conflictingFields}
 *   sourceBranchName="feature"
 *   targetBranchName="main"
 *   resolutions={resolutions}
 *   onResolutionChange={handleChange}
 * />
 * ```
 */
export function ComponentConflictGroup({
  componentType,
  componentId,
  fields,
  sourceBranchName,
  targetBranchName,
  resolutions,
  onResolutionChange,
}: ComponentConflictGroupProps): React.ReactElement {
  const conflictCount = fields.filter(
    (f) => f.classification === 'conflicting'
  ).length;

  return (
    <div className={baseClass} style={containerStyle}>
      {/* Component header */}
      <div className={`${baseClass}__header`} style={headerStyle}>
        <h3 className={`${baseClass}__title`} style={titleStyle}>{componentType}</h3>
        <span className={`${baseClass}__conflict-count`} style={conflictCountStyle}>
          {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
        </span>
      </div>

      {/* Field list */}
      <div className={`${baseClass}__fields`} style={fieldsContainerStyle}>
        {fields.map((field) => {
          const radioName = `${componentId}-${field.propName}`;

          return (
            <div key={field.propName} className={`${baseClass}__field`} style={fieldRowStyle}>
              <div className={`${baseClass}__field-name`} style={fieldNameStyle}>
                {field.propName}
              </div>

              <div className={`${baseClass}__field-values`} style={fieldValuesStyle}>
                {/* Source value */}
                <label className={`${baseClass}__option`} style={optionLabelStyle}>
                  <input
                    type="radio"
                    name={radioName}
                    value="source"
                    checked={resolutions[field.propName] === 'source'}
                    onChange={() =>
                      onResolutionChange(componentId, field.propName, 'source')
                    }
                  />
                  <span className={`${baseClass}__branch-name`} style={branchNameStyle}>
                    {sourceBranchName}:
                  </span>{' '}
                  <span className={`${baseClass}__value`} style={valueStyle}>
                    {formatValue(field.sourceValue)}
                  </span>
                </label>

                {/* Target value */}
                <label className={`${baseClass}__option`} style={optionLabelStyle}>
                  <input
                    type="radio"
                    name={radioName}
                    value="target"
                    checked={resolutions[field.propName] === 'target'}
                    onChange={() =>
                      onResolutionChange(componentId, field.propName, 'target')
                    }
                  />
                  <span className={`${baseClass}__branch-name`} style={branchNameStyle}>
                    {targetBranchName}:
                  </span>{' '}
                  <span className={`${baseClass}__value`} style={valueStyle}>
                    {formatValue(field.targetValue)}
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
