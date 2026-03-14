/**
 * PuckFieldResolutionPanel Component
 *
 * Main panel for Puck-aware field-level conflict resolution. Groups
 * conflicts by component, separates auto-merged fields from conflicting
 * fields, and provides radio-button resolution for each conflict.
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { PuckData } from '@pantheon/css-client';
import {
  classifyPuckFields,
  groupFieldsByComponent,
  buildMergedSnapshot,
} from '../../utils/puckFieldClassifier.js';
import type { ResolutionMap } from '../../utils/puckFieldClassifier.js';
import { ComponentConflictGroup } from './ComponentConflictGroup.js';

/**
 * Props for the PuckFieldResolutionPanel component.
 */
export interface PuckFieldResolutionPanelProps {
  /** The source branch snapshot */
  sourceSnapshot: PuckData;
  /** The target branch snapshot */
  targetSnapshot: PuckData;
  /** The common ancestor snapshot (null for two-way comparison) */
  baseSnapshot: PuckData | null;
  /** Display name of the source branch */
  sourceBranchName: string;
  /** Display name of the target branch */
  targetBranchName: string;
  /** Callback with the merged PuckData when user applies resolutions */
  onResolve: (merged: PuckData) => void;
}

const baseClass = 'puck-field-resolution-panel';

/**
 * Builds a unique key for a field resolution entry.
 */
function fieldKey(componentId: string, propName: string): string {
  return `${componentId}:${propName}`;
}

/**
 * Main panel for Puck-aware field-level conflict resolution.
 *
 * Classifies all field changes between source and target, separates
 * auto-merged fields from true conflicts, and renders radio-button
 * resolution UI grouped by component.
 *
 * @param props - {@link PuckFieldResolutionPanelProps}
 * @returns A React element containing the resolution UI with auto-merge summary,
 *          conflict groups, and an apply button.
 *
 * @example
 * ```tsx
 * <PuckFieldResolutionPanel
 *   sourceSnapshot={sourceBranchData}
 *   targetSnapshot={targetBranchData}
 *   baseSnapshot={commonAncestor}
 *   sourceBranchName="feature-branch"
 *   targetBranchName="main"
 *   onResolve={(merged) => saveMerged(merged)}
 * />
 * ```
 */
export function PuckFieldResolutionPanel({
  sourceSnapshot,
  targetSnapshot,
  baseSnapshot,
  sourceBranchName,
  targetBranchName,
  onResolve,
}: PuckFieldResolutionPanelProps): React.ReactElement {
  // Classify all fields
  const allFields = useMemo(
    () => classifyPuckFields(sourceSnapshot, targetSnapshot, baseSnapshot),
    [sourceSnapshot, targetSnapshot, baseSnapshot]
  );

  // Separate auto-merged from conflicting
  const autoMergedFields = useMemo(
    () =>
      allFields.filter(
        (f) =>
          f.classification === 'source-only' ||
          f.classification === 'target-only'
      ),
    [allFields]
  );

  const conflictingFields = useMemo(
    () => allFields.filter((f) => f.classification === 'conflicting'),
    [allFields]
  );

  // Group conflicting fields by component
  const conflictGroups = useMemo(
    () => groupFieldsByComponent(conflictingFields),
    [conflictingFields]
  );

  // Resolution state
  const [resolutions, setResolutions] = useState<ResolutionMap>({});

  // Check if all conflicts are resolved
  const allResolved = useMemo(() => {
    if (conflictingFields.length === 0) return true;
    return conflictingFields.every(
      (f) => resolutions[fieldKey(f.componentId, f.propName)] !== undefined
    );
  }, [conflictingFields, resolutions]);

  // Handle resolution change
  const handleResolutionChange = useCallback(
    (componentId: string, propName: string, choice: 'source' | 'target') => {
      setResolutions((prev) => ({
        ...prev,
        [fieldKey(componentId, propName)]: choice,
      }));
    },
    []
  );

  // Handle apply
  const handleApply = useCallback(() => {
    const merged = buildMergedSnapshot(
      sourceSnapshot,
      targetSnapshot,
      allFields,
      resolutions
    );
    onResolve(merged);
  }, [sourceSnapshot, targetSnapshot, allFields, resolutions, onResolve]);

  return (
    <div className={baseClass}>
      <h2 className={`${baseClass}__title`}>Resolve field conflicts</h2>

      {/* Auto-merged fields summary */}
      {autoMergedFields.length > 0 && (
        <div className={`${baseClass}__auto-merged`}>
          <p className={`${baseClass}__auto-merged-summary`}>
            {autoMergedFields.length}{' '}
            {autoMergedFields.length === 1 ? 'field was' : 'fields were'} auto-merged
          </p>
        </div>
      )}

      {/* Conflicting fields grouped by component */}
      {conflictGroups.length > 0 && (
        <div className={`${baseClass}__conflicts`}>
          <h3 className={`${baseClass}__conflicts-title`}>
            Conflicts requiring resolution
          </h3>
          {conflictGroups.map((group) => (
            <ComponentConflictGroup
              key={group.componentId}
              componentType={group.componentType}
              componentId={group.componentId}
              fields={group.fields}
              sourceBranchName={sourceBranchName}
              targetBranchName={targetBranchName}
              resolutions={
                Object.fromEntries(
                  Object.entries(resolutions)
                    .filter(([k]) => k.startsWith(`${group.componentId}:`))
                    .map(([k, v]) => [k.split(':').slice(1).join(':'), v])
                )
              }
              onResolutionChange={handleResolutionChange}
            />
          ))}
        </div>
      )}

      {/* No conflicts message */}
      {conflictGroups.length === 0 && autoMergedFields.length > 0 && (
        <p className={`${baseClass}__no-conflicts`}>
          All changes were auto-merged. No manual resolution needed.
        </p>
      )}

      {/* Apply button */}
      <div className={`${baseClass}__actions`}>
        <button
          type="button"
          className={`${baseClass}__apply-button`}
          disabled={!allResolved}
          onClick={handleApply}
        >
          Apply resolution
        </button>
      </div>
    </div>
  );
}
