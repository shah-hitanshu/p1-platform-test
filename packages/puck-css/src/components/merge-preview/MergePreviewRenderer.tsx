/**
 * MergePreviewRenderer Component
 *
 * Renders diff-highlighted content in side-by-side, overlay, or slider mode.
 * Uses Puck's Render component with highlighted configs for visual comparison.
 *
 * All visual styling uses inline React styles. BEM class names are retained
 * as secondary identifiers for DOM querying and test assertions.
 */

import React, { useMemo, useState } from 'react';
import { Render } from '@puckeditor/core';
import type { PuckData } from '@pantheon/css-client';
import type { ComponentDiffWithPosition } from '../../types.js';
import { createDiffMap, createHighlightedConfig } from '../../utils/highlightConfig.js';
import type { ViewMode } from './ViewModeSelector.js';

/**
 * Props for the MergePreviewRenderer component.
 */
export interface MergePreviewRendererProps {
  /** Puck data from the source branch. */
  sourceData: PuckData;

  /** Puck data from the target branch. */
  targetData: PuckData;

  /** Component-level diffs with position information. */
  diffs: ComponentDiffWithPosition[];

  /** Puck configuration for rendering components. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;

  /** The current view mode. */
  viewMode: ViewMode;

  /** Name of the source branch. */
  sourceBranchName: string;

  /** Name of the target branch. */
  targetBranchName: string;
}

// =============================================================================
// Inline Style Constants
// =============================================================================

const wrapperStyle: React.CSSProperties = {
  position: 'relative',
};

const summaryStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  color: '#666',
  borderBottom: '1px solid #e5e7eb',
};

const sideBySideContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
};

const panelStyle: React.CSSProperties = {
  flex: '1 1 50%',
  minWidth: 0,
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

const overlayContainerStyle: React.CSSProperties = {
  position: 'relative',
};

const overlaySourceLayerStyle: React.CSSProperties = {
  position: 'relative',
};

const overlayTargetLayerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
};

const sliderControlStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '8px 12px',
};

const sliderInputStyle: React.CSSProperties = {
  flex: 1,
};

const sliderContentStyle: React.CSSProperties = {
  position: 'relative',
};

const emptyStyle: React.CSSProperties = {
  padding: '40px',
  textAlign: 'center',
  color: '#999',
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Counts diffs by type, returning only non-unchanged counts.
 */
function countChanges(diffs: ComponentDiffWithPosition[]): {
  added: number;
  removed: number;
  modified: number;
} {
  const counts = { added: 0, removed: 0, modified: 0 };
  for (const diff of diffs) {
    if (diff.type === 'added') counts.added++;
    else if (diff.type === 'removed') counts.removed++;
    else if (diff.type === 'modified') counts.modified++;
  }
  return counts;
}

/**
 * Formats a change count summary string from diff counts.
 */
function formatChangeSummary(counts: {
  added: number;
  removed: number;
  modified: number;
}): string {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.removed > 0) parts.push(`${counts.removed} removed`);
  if (counts.modified > 0) parts.push(`${counts.modified} modified`);
  return parts.join(', ');
}

// =============================================================================
// Sub-components
// =============================================================================

/**
 * Renders side-by-side comparison panels.
 */
function SideBySideView({
  sourceData,
  targetData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterConfig,
  sourceBranchName,
  targetBranchName,
}: {
  sourceData: PuckData;
  targetData: PuckData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeConfig: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterConfig: any;
  sourceBranchName: string;
  targetBranchName: string;
}): React.ReactElement {
  return (
    <div
      className="merge-preview-renderer merge-preview-renderer--side-by-side"
      style={sideBySideContainerStyle}
    >
      <div className="merge-preview-renderer__panel" style={panelStyle}>
        <div className="merge-preview-renderer__panel-label" style={panelLabelStyle}>
          {sourceBranchName}
        </div>
        <div className="merge-preview-renderer__panel-content" style={panelContentStyle}>
          <Render
            config={beforeConfig as Parameters<typeof Render>[0]['config']}
            data={sourceData as Parameters<typeof Render>[0]['data']}
          />
        </div>
      </div>
      <div className="merge-preview-renderer__panel" style={panelStyle}>
        <div className="merge-preview-renderer__panel-label" style={panelLabelStyle}>
          {targetBranchName}
        </div>
        <div className="merge-preview-renderer__panel-content" style={panelContentStyle}>
          <Render
            config={afterConfig as Parameters<typeof Render>[0]['config']}
            data={targetData as Parameters<typeof Render>[0]['data']}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders overlay comparison mode.
 */
function OverlayView({
  sourceData,
  targetData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterConfig,
  sourceBranchName,
  targetBranchName,
}: {
  sourceData: PuckData;
  targetData: PuckData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeConfig: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterConfig: any;
  sourceBranchName: string;
  targetBranchName: string;
}): React.ReactElement {
  return (
    <div
      className="merge-preview-renderer merge-preview-renderer--overlay"
      style={overlayContainerStyle}
    >
      <div
        className="merge-preview-renderer__overlay-layer merge-preview-renderer__overlay-layer--source"
        style={overlaySourceLayerStyle}
      >
        <div className="merge-preview-renderer__panel-label" style={panelLabelStyle}>
          {sourceBranchName}
        </div>
        <Render
          config={beforeConfig as Parameters<typeof Render>[0]['config']}
          data={sourceData as Parameters<typeof Render>[0]['data']}
        />
      </div>
      <div
        className="merge-preview-renderer__overlay-layer merge-preview-renderer__overlay-layer--target"
        style={overlayTargetLayerStyle}
      >
        <div className="merge-preview-renderer__panel-label" style={panelLabelStyle}>
          {targetBranchName}
        </div>
        <Render
          config={afterConfig as Parameters<typeof Render>[0]['config']}
          data={targetData as Parameters<typeof Render>[0]['data']}
        />
      </div>
    </div>
  );
}

/**
 * Renders slider comparison mode with a range input.
 */
function SliderView({
  sourceData,
  targetData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterConfig,
  sourceBranchName,
  targetBranchName,
}: {
  sourceData: PuckData;
  targetData: PuckData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeConfig: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterConfig: any;
  sourceBranchName: string;
  targetBranchName: string;
}): React.ReactElement {
  const [sliderValue, setSliderValue] = useState(50);

  return (
    <div
      className="merge-preview-renderer merge-preview-renderer--slider"
      style={{ position: 'relative' }}
    >
      <div className="merge-preview-renderer__slider-control" style={sliderControlStyle}>
        <span className="merge-preview-renderer__panel-label" style={panelLabelStyle}>
          {sourceBranchName}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={(e) => setSliderValue(Number(e.target.value))}
          className="merge-preview-renderer__slider-input"
          style={sliderInputStyle}
        />
        <span className="merge-preview-renderer__panel-label" style={panelLabelStyle}>
          {targetBranchName}
        </span>
      </div>
      <div className="merge-preview-renderer__slider-content" style={sliderContentStyle}>
        <div
          className="merge-preview-renderer__slider-layer merge-preview-renderer__slider-layer--source"
          style={{ opacity: 1 - sliderValue / 100, position: 'relative' }}
        >
          <Render
            config={beforeConfig as Parameters<typeof Render>[0]['config']}
            data={sourceData as Parameters<typeof Render>[0]['data']}
          />
        </div>
        <div
          className="merge-preview-renderer__slider-layer merge-preview-renderer__slider-layer--target"
          style={{
            opacity: sliderValue / 100,
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
          }}
        >
          <Render
            config={afterConfig as Parameters<typeof Render>[0]['config']}
            data={targetData as Parameters<typeof Render>[0]['data']}
          />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Renders diff-highlighted content in the selected view mode.
 *
 * Supports three modes:
 * - **side-by-side**: Two panels showing source and target with diff highlights
 * - **overlay**: Layered view of both versions
 * - **slider**: Range slider to blend between source and target
 *
 * @param props - {@link MergePreviewRendererProps}
 * @returns A React element rendering the diff-highlighted comparison in the chosen view mode.
 *
 * @example
 * ```tsx
 * <MergePreviewRenderer
 *   sourceData={sourceData}
 *   targetData={targetData}
 *   diffs={diffs}
 *   config={puckConfig}
 *   viewMode="side-by-side"
 *   sourceBranchName="feature"
 *   targetBranchName="main"
 * />
 * ```
 */
export function MergePreviewRenderer({
  sourceData,
  targetData,
  diffs,
  config,
  viewMode,
  sourceBranchName,
  targetBranchName,
}: MergePreviewRendererProps): React.ReactElement {
  const diffMap = useMemo(() => createDiffMap(diffs), [diffs]);
  const counts = useMemo(() => countChanges(diffs), [diffs]);
  const changeSummary = useMemo(() => formatChangeSummary(counts), [counts]);

  const beforeConfig = useMemo(
    () => createHighlightedConfig(config, diffMap, 'before'),
    [config, diffMap],
  );
  const afterConfig = useMemo(
    () => createHighlightedConfig(config, diffMap, 'after'),
    [config, diffMap],
  );

  const hasChanges = diffs.some((d) => d.type !== 'unchanged');

  if (!hasChanges) {
    return (
      <div
        className="merge-preview-renderer merge-preview-renderer--empty"
        style={emptyStyle}
      >
        <p>No changes</p>
      </div>
    );
  }

  // In a merge comparison, source = branch (the "after" state) and
  // target = main (the "before" state).  Swap configs so that:
  //   - source/branch panel highlights "added" items (green)
  //   - target/main panel highlights "removed" items (red)
  const sideBySideProps = {
    sourceData,
    targetData,
    beforeConfig: afterConfig,   // branch panel shows added + modified
    afterConfig: beforeConfig,   // main panel shows removed + modified
    sourceBranchName,
    targetBranchName,
  };

  // Overlay and slider modes are pure visual comparisons --
  // diff highlighting is redundant and visually noisy.
  const visualProps = {
    sourceData,
    targetData,
    beforeConfig: config,
    afterConfig: config,
    sourceBranchName,
    targetBranchName,
  };

  return (
    <div className="merge-preview-renderer__wrapper" style={wrapperStyle}>
      <div className="merge-preview-renderer__summary" style={summaryStyle}>
        {changeSummary}
      </div>

      {viewMode === 'side-by-side' && <SideBySideView {...sideBySideProps} />}
      {viewMode === 'overlay' && <OverlayView {...visualProps} />}
      {viewMode === 'slider' && <SliderView {...visualProps} />}
    </div>
  );
}
