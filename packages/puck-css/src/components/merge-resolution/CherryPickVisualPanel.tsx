/**
 * CherryPickVisualPanel Component
 *
 * Two-column layout for cherry-pick with visual comparison and live merged preview.
 * The left column shows two rendered Puck pages (Draft and Live) with
 * ComponentClickOverlay on each, plus prop-level controls below.
 * The right column shows a live-updating merged preview.
 *
 * Does NOT use MergePreviewRenderer (see PLAN.md Decision 3).
 * Instead renders two separate <Render> instances directly, each with its own
 * ComponentClickOverlay for unambiguous panel-level click handling.
 *
 * All visual styling uses inline React styles.
 */

import React, { useRef, useMemo } from 'react';
import { Render } from '@puckeditor/core';
import type { DocumentResolution } from '../../hooks/useMergeResolution.js';
import type { ComponentDiffWithPosition } from '../../types.js';
import { createDiffMap, createHighlightedConfig } from '../../utils/highlightConfig.js';
import { groupFieldsByComponent } from '../../utils/puckFieldClassifier.js';
import { ScaledContent } from '../merge-preview/ScaledContent.js';
import { ComponentClickOverlay } from './ComponentClickOverlay.js';
import { ComponentConflictGroup } from '../conflict-resolution/ComponentConflictGroup.js';

/**
 * Props for the CherryPickVisualPanel component.
 */
export interface CherryPickVisualPanelProps {
  /** Current document being resolved */
  document: DocumentResolution;
  /** Puck config for rendering */
  config: unknown;
  /** Component-level diffs for highlighting */
  diffs: ComponentDiffWithPosition[];
  /** Source branch display name */
  sourceBranchName: string;
  /** Target branch display name */
  targetBranchName: string;
  /** Callback for individual prop selection */
  onCherryPickSelection: (
    documentId: string,
    componentId: string,
    propName: string,
    choice: 'source' | 'target'
  ) => void;
  /** Callback for accepting all props of a component */
  onAcceptAllComponentProps: (
    documentId: string,
    componentId: string,
    choice: 'source' | 'target'
  ) => void;
}

// =============================================================================
// Inline Style Constants
// =============================================================================

const containerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  marginTop: '16px',
};

const leftColumnStyle: React.CSSProperties = {
  flex: '0 0 60%',
  minWidth: 0,
};

const rightColumnStyle: React.CSSProperties = {
  flex: '0 0 40%',
  minWidth: 0,
};

const comparisonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  marginBottom: '16px',
};

const renderPanelStyle: React.CSSProperties = {
  flex: '1 1 50%',
  minWidth: 0,
  position: 'relative',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
};

const panelLabelStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: '13px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
};

const panelContentStyle: React.CSSProperties = {
  padding: '12px',
};

const mergedPreviewHeaderStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: '14px',
  background: '#f0f9ff',
  borderBottom: '1px solid #e5e7eb',
  color: '#0369a1',
  borderRadius: '8px 8px 0 0',
};

const mergedPreviewContainerStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
};

const mergedPreviewContentStyle: React.CSSProperties = {
  padding: '12px',
};

const promptStyle: React.CSSProperties = {
  padding: '40px 20px',
  textAlign: 'center',
  color: '#999',
  fontStyle: 'italic',
};

const conflictSectionStyle: React.CSSProperties = {
  marginTop: '16px',
};

const componentGroupStyle: React.CSSProperties = {
  marginBottom: '16px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '12px',
};

const componentActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '8px',
};

const acceptButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: '#ccc',
  background: 'white',
  cursor: 'pointer',
  fontSize: '12px',
};

const autoMergedStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
  marginBottom: '12px',
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Derives per-component selection state from cherry-pick selections.
 * For a component, if ALL conflicting props are resolved to 'source',
 * returns 'source'. If all 'target', returns 'target'. Otherwise 'none'.
 */
function deriveComponentSelections(
  document: DocumentResolution
): Record<string, 'source' | 'target' | 'none'> {
  const result: Record<string, 'source' | 'target' | 'none'> = {};

  if (!document.classifiedFields) return result;

  // Group conflicting fields by component
  const componentConflicts = new Map<string, string[]>();
  for (const field of document.classifiedFields) {
    if (field.classification === 'conflicting') {
      const existing = componentConflicts.get(field.componentId) || [];
      existing.push(field.propName);
      componentConflicts.set(field.componentId, existing);
    }
  }

  for (const [componentId, propNames] of componentConflicts) {
    const selections = propNames.map(
      (propName) => document.cherryPickSelections[`${componentId}:${propName}`]
    );

    if (selections.length === 0) {
      result[componentId] = 'none';
    } else if (selections.every((s) => s === 'source')) {
      result[componentId] = 'source';
    } else if (selections.every((s) => s === 'target')) {
      result[componentId] = 'target';
    } else {
      result[componentId] = 'none';
    }
  }

  return result;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Visual cherry-pick panel with two-column layout.
 *
 * @param props - {@link CherryPickVisualPanelProps}
 * @returns A React element with visual comparison and merged preview.
 */
export function CherryPickVisualPanel({
  document: doc,
  config,
  diffs,
  sourceBranchName,
  targetBranchName,
  onCherryPickSelection,
  onAcceptAllComponentProps,
}: CherryPickVisualPanelProps): React.ReactElement {
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const targetContainerRef = useRef<HTMLDivElement>(null);

  // Create highlighted configs for diff visualization
  const diffMap = useMemo(() => createDiffMap(diffs), [diffs]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sourceHighlightedConfig = useMemo(
    () => createHighlightedConfig(config as Record<string, unknown>, diffMap, 'after'),
    [config, diffMap],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetHighlightedConfig = useMemo(
    () => createHighlightedConfig(config as Record<string, unknown>, diffMap, 'before'),
    [config, diffMap],
  );

  // Derive per-component selection state for overlay indicators
  const componentSelections = useMemo(
    () => deriveComponentSelections(doc),
    [doc],
  );

  // Group classified fields by component for prop-level controls
  const componentGroups = doc.classifiedFields
    ? groupFieldsByComponent(doc.classifiedFields)
    : [];

  // Count auto-merged (non-conflicting) fields
  const autoMergedCount = doc.classifiedFields
    ? doc.classifiedFields.filter((f) => f.classification !== 'conflicting').length
    : 0;

  const sourceData = doc.sourceSnapshot;
  const targetData = doc.targetSnapshot;

  return (
    <div className="cherry-pick-visual-panel" style={containerStyle}>
      {/* Left column: visual comparison + prop controls */}
      <div className="cherry-pick-visual-panel__left" style={leftColumnStyle}>
        {/* Side-by-side rendered panels */}
        {sourceData && targetData && (
          <div className="cherry-pick-visual-panel__comparison" style={comparisonRowStyle}>
            {/* Draft (source) panel */}
            <div className="cherry-pick-visual-panel__render-panel" style={renderPanelStyle}>
              <div className="cherry-pick-visual-panel__panel-label" style={panelLabelStyle}>
                {sourceBranchName}
              </div>
              <div
                className="cherry-pick-visual-panel__panel-content"
                style={panelContentStyle}
                ref={sourceContainerRef}
              >
                <ScaledContent>
                  <Render
                    config={sourceHighlightedConfig as Parameters<typeof Render>[0]['config']}
                    data={sourceData as Parameters<typeof Render>[0]['data']}
                  />
                </ScaledContent>
              </div>
              <ComponentClickOverlay
                containerRef={sourceContainerRef}
                selections={componentSelections}
                onComponentClick={(componentId) =>
                  onAcceptAllComponentProps(doc.documentId, componentId, 'source')
                }
                interactive={true}
                branchLabel={sourceBranchName}
              />
            </div>

            {/* Live (target) panel */}
            <div className="cherry-pick-visual-panel__render-panel" style={renderPanelStyle}>
              <div className="cherry-pick-visual-panel__panel-label" style={panelLabelStyle}>
                {targetBranchName}
              </div>
              <div
                className="cherry-pick-visual-panel__panel-content"
                style={panelContentStyle}
                ref={targetContainerRef}
              >
                <ScaledContent>
                  <Render
                    config={targetHighlightedConfig as Parameters<typeof Render>[0]['config']}
                    data={targetData as Parameters<typeof Render>[0]['data']}
                  />
                </ScaledContent>
              </div>
              <ComponentClickOverlay
                containerRef={targetContainerRef}
                selections={componentSelections}
                onComponentClick={(componentId) =>
                  onAcceptAllComponentProps(doc.documentId, componentId, 'target')
                }
                interactive={true}
                branchLabel={targetBranchName}
              />
            </div>
          </div>
        )}

        {/* Prop-level controls */}
        {componentGroups.length > 0 && (
          <div className="cherry-pick-visual-panel__conflicts" style={conflictSectionStyle}>
            {autoMergedCount > 0 && (
              <p className="cherry-pick-visual-panel__auto-merged" style={autoMergedStyle}>
                {autoMergedCount} {autoMergedCount === 1 ? 'field' : 'fields'} auto-merged
              </p>
            )}

            {componentGroups.map((group) => (
              <div
                key={group.componentId}
                className="cherry-pick-visual-panel__component-group"
                style={componentGroupStyle}
              >
                <div
                  className="cherry-pick-visual-panel__component-actions"
                  style={componentActionsStyle}
                >
                  <button
                    type="button"
                    className="cherry-pick-visual-panel__accept-button"
                    style={acceptButtonStyle}
                    onClick={() =>
                      onAcceptAllComponentProps(doc.documentId, group.componentId, 'source')
                    }
                  >
                    Accept all from Draft
                  </button>
                  <button
                    type="button"
                    className="cherry-pick-visual-panel__accept-button"
                    style={acceptButtonStyle}
                    onClick={() =>
                      onAcceptAllComponentProps(doc.documentId, group.componentId, 'target')
                    }
                  >
                    Accept all from Live
                  </button>
                </div>
                <ComponentConflictGroup
                  componentType={group.componentType}
                  componentId={group.componentId}
                  fields={group.fields}
                  sourceBranchName={sourceBranchName}
                  targetBranchName={targetBranchName}
                  resolutions={
                    Object.fromEntries(
                      Object.entries(doc.cherryPickSelections)
                        .filter(([k]) => k.startsWith(`${group.componentId}:`))
                        .map(([k, v]) => [k.split(':').slice(1).join(':'), v])
                    )
                  }
                  onResolutionChange={(componentId, propName, choice) =>
                    onCherryPickSelection(doc.documentId, componentId, propName, choice)
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right column: merged preview */}
      <div className="cherry-pick-visual-panel__right" style={rightColumnStyle}>
        <div
          className="cherry-pick-visual-panel__merged-preview"
          style={mergedPreviewContainerStyle}
        >
          <div
            className="cherry-pick-visual-panel__merged-header"
            style={mergedPreviewHeaderStyle}
          >
            Merged Preview
          </div>
          <div
            className="cherry-pick-visual-panel__merged-content"
            style={mergedPreviewContentStyle}
          >
            {doc.mergedSnapshot ? (
              <ScaledContent>
                <Render
                  config={config as Parameters<typeof Render>[0]['config']}
                  data={doc.mergedSnapshot as Parameters<typeof Render>[0]['data']}
                />
              </ScaledContent>
            ) : (
              <p
                className="cherry-pick-visual-panel__merged-prompt"
                style={promptStyle}
              >
                Make selections to see the merged preview
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
