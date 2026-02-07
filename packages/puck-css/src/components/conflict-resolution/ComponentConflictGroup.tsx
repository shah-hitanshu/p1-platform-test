/**
 * ComponentConflictGroup Component
 *
 * Displays conflicts for a single Puck component, showing each conflicting
 * prop with source and target values and radio buttons for resolution.
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
    <div className={baseClass}>
      {/* Component header */}
      <div className={`${baseClass}__header`}>
        <h3 className={`${baseClass}__title`}>{componentType}</h3>
        <span className={`${baseClass}__conflict-count`}>
          {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
        </span>
      </div>

      {/* Field list */}
      <div className={`${baseClass}__fields`}>
        {fields.map((field) => {
          const radioName = `${componentId}-${field.propName}`;

          return (
            <div key={field.propName} className={`${baseClass}__field`}>
              <div className={`${baseClass}__field-name`}>
                {field.propName}
              </div>

              <div className={`${baseClass}__field-values`}>
                {/* Source value */}
                <label className={`${baseClass}__option`}>
                  <input
                    type="radio"
                    name={radioName}
                    value="source"
                    checked={resolutions[field.propName] === 'source'}
                    onChange={() =>
                      onResolutionChange(componentId, field.propName, 'source')
                    }
                  />
                  <span className={`${baseClass}__branch-name`}>
                    {sourceBranchName}:
                  </span>{' '}
                  <span className={`${baseClass}__value`}>
                    {formatValue(field.sourceValue)}
                  </span>
                </label>

                {/* Target value */}
                <label className={`${baseClass}__option`}>
                  <input
                    type="radio"
                    name={radioName}
                    value="target"
                    checked={resolutions[field.propName] === 'target'}
                    onChange={() =>
                      onResolutionChange(componentId, field.propName, 'target')
                    }
                  />
                  <span className={`${baseClass}__branch-name`}>
                    {targetBranchName}:
                  </span>{' '}
                  <span className={`${baseClass}__value`}>
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
