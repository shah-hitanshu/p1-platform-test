/**
 * PuckFieldResolutionPanel Component
 *
 * Main panel for Puck-aware field-level conflict resolution. Groups
 * conflicts by component, separates auto-merged fields from conflicting
 * fields, and provides radio-button resolution for each conflict.
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { PuckData, PuckComponentData } from '@pantheon/css-client';
import {
  classifyPuckFields,
  groupFieldsByComponent,
} from '../../utils/puckFieldClassifier.js';
import type { PuckFieldClassification } from '../../utils/puckFieldClassifier.js';
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
 * Tracks resolution choices keyed by "componentId:propName".
 */
type ResolutionMap = Record<string, 'source' | 'target'>;

/**
 * Builds a unique key for a field resolution entry.
 */
function fieldKey(componentId: string, propName: string): string {
  return `${componentId}:${propName}`;
}

/**
 * Constructs the merged PuckData snapshot from resolution choices.
 *
 * Strategy:
 * - Start with a deep clone of the target snapshot as the base
 * - Apply source-only changes (overwrite with source values)
 * - Keep target-only changes (already in target clone)
 * - Apply user conflict resolutions (source or target)
 */
function buildMergedSnapshot(
  source: PuckData,
  target: PuckData,
  fields: PuckFieldClassification[],
  resolutions: ResolutionMap
): PuckData {
  // Deep clone target as starting point
  const merged: PuckData = JSON.parse(JSON.stringify(target));

  // Build lookup maps for source components
  const sourceContentMap = new Map<string, PuckComponentData>();
  for (const comp of source.content) {
    sourceContentMap.set(comp.props.id, comp);
  }

  // Build lookup maps for merged (target-based) components
  const mergedContentMap = new Map<string, PuckComponentData>();
  for (const comp of merged.content) {
    mergedContentMap.set(comp.props.id, comp);
  }

  // Apply field resolutions
  for (const field of fields) {
    const key = fieldKey(field.componentId, field.propName);
    let useSource = false;

    if (field.classification === 'source-only') {
      // Auto-merge: take source value
      useSource = true;
    } else if (field.classification === 'target-only') {
      // Auto-merge: keep target value (already in merged)
      useSource = false;
    } else if (field.classification === 'conflicting') {
      // Use user's resolution
      useSource = resolutions[key] === 'source';
    }

    if (field.componentId === 'root') {
      // Apply to root props
      if (useSource) {
        if (!merged.root.props) {
          merged.root.props = {};
        }
        merged.root.props[field.propName] = JSON.parse(
          JSON.stringify(field.sourceValue)
        );
      }
    } else if (field.path.startsWith('zones/')) {
      // Apply to zone component
      const zoneName = field.path.slice('zones/'.length);
      const zoneComponents = merged.zones?.[zoneName];
      if (zoneComponents) {
        const comp = zoneComponents.find(
          (c) => c.props.id === field.componentId
        );
        if (comp && useSource) {
          comp.props[field.propName] = JSON.parse(
            JSON.stringify(field.sourceValue)
          );
        }
      }
    } else {
      // Apply to content component
      const comp = mergedContentMap.get(field.componentId);
      if (comp && useSource) {
        comp.props[field.propName] = JSON.parse(
          JSON.stringify(field.sourceValue)
        );
      }
    }
  }

  return merged;
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
