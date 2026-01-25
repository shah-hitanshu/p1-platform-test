/**
 * VisualVersionCompare Component
 *
 * Side-by-side visual comparison of two Puck page versions with diff highlighting.
 * Uses Puck's Render component to display actual rendered content.
 */

import React, { useMemo } from 'react';
import { Render } from '@puckeditor/core';
import type { ComponentDiffWithPosition } from '../../types.js';
import { DiffHeader } from './DiffHeader.js';

/**
 * Puck Data structure (flexible to accept various sources)
 */
interface PuckData {
  content: Array<{
    type: string;
    props: Record<string, unknown> & { id: string };
  }>;
  root: { props?: Record<string, unknown> };
}

/**
 * Puck Config structure (flexible to accept Puck's Config type)
 * Uses a loose type to accept any Puck config
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PuckConfig = Record<string, any>;

export interface VisualVersionCompareProps {
  /**
   * The before version number.
   */
  beforeVersion: number;

  /**
   * The after version number.
   */
  afterVersion: number;

  /**
   * The Puck data from the before version.
   */
  beforeData: PuckData;

  /**
   * The Puck data from the after version.
   */
  afterData: PuckData;

  /**
   * The Puck configuration for rendering components.
   */
  config: PuckConfig;

  /**
   * Array of component diffs with position information.
   */
  diffs: ComponentDiffWithPosition[];

  /**
   * Callback when the comparison is closed.
   */
  onClose: () => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Counts diffs by type.
 */
function countDiffs(diffs: ComponentDiffWithPosition[]): {
  added: number;
  removed: number;
  modified: number;
  reordered: number;
} {
  const counts = { added: 0, removed: 0, modified: 0, reordered: 0 };
  for (const diff of diffs) {
    if (diff.type === 'added') counts.added++;
    else if (diff.type === 'removed') counts.removed++;
    else if (diff.type === 'modified') counts.modified++;
    else if (diff.type === 'reordered') counts.reordered++;
  }
  return counts;
}

/**
 * Creates a map of component IDs to their diff types.
 */
function createDiffMap(
  diffs: ComponentDiffWithPosition[]
): Map<string, ComponentDiffWithPosition['type']> {
  const map = new Map<string, ComponentDiffWithPosition['type']>();
  for (const diff of diffs) {
    if (diff.type !== 'unchanged') {
      map.set(diff.componentId, diff.type);
    }
  }
  return map;
}

/**
 * Wraps a Puck config to add diff highlighting to rendered components.
 */
function createHighlightedConfig(
  config: PuckConfig,
  diffMap: Map<string, ComponentDiffWithPosition['type']>,
  side: 'before' | 'after'
): PuckConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedComponents: Record<string, any> = {};
  const components = config.components as Record<string, { render: unknown }>;

  for (const [componentName, componentConfig] of Object.entries(components)) {
    // Cast render to the function type we need
    const originalRender = componentConfig.render as (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: any
    ) => React.ReactNode;

    wrappedComponents[componentName] = {
      ...componentConfig,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (props: any) => {
        const id = props.id as string;
        const diffType = diffMap.get(id);

        // Only show diff styling for relevant changes on each side
        const shouldHighlight =
          diffType &&
          ((side === 'before' && (diffType === 'removed' || diffType === 'modified')) ||
            (side === 'after' && (diffType === 'added' || diffType === 'modified')));

        const renderedContent = originalRender(props);

        if (!shouldHighlight) {
          return renderedContent;
        }

        return (
          <div
            className={`visual-diff-highlight visual-diff-highlight--${diffType}`}
            data-diff-type={diffType}
            data-component-id={id}
          >
            {renderedContent}
            <div className={`visual-diff-badge visual-diff-badge--${diffType}`}>
              {diffType === 'added' && '+'}
              {diffType === 'removed' && '−'}
              {diffType === 'modified' && '~'}
            </div>
          </div>
        );
      },
    };
  }

  return { ...config, components: wrappedComponents };
}

/**
 * Renders a side-by-side visual comparison of two Puck page versions.
 */
export function VisualVersionCompare({
  beforeVersion,
  afterVersion,
  beforeData,
  afterData,
  config,
  diffs,
  onClose,
  className = '',
}: VisualVersionCompareProps): React.ReactElement {
  const baseClass = 'visual-version-compare';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  const counts = useMemo(() => countDiffs(diffs), [diffs]);
  const isEmpty = diffs.length === 0;
  const diffMap = useMemo(() => createDiffMap(diffs), [diffs]);

  // Create highlighted configs for each side
  const beforeConfig = useMemo(
    () => createHighlightedConfig(config, diffMap, 'before'),
    [config, diffMap]
  );
  const afterConfig = useMemo(
    () => createHighlightedConfig(config, diffMap, 'after'),
    [config, diffMap]
  );

  return (
    <div className={classes}>
      <DiffHeader
        beforeVersion={beforeVersion}
        afterVersion={afterVersion}
        added={counts.added}
        removed={counts.removed}
        modified={counts.modified}
        reordered={counts.reordered}
        onClose={onClose}
      />

      {/* Legend */}
      <div className={`${baseClass}__legend`}>
        <span className={`${baseClass}__legend-item ${baseClass}__legend-item--added`}>
          <span className={`${baseClass}__legend-color`} /> Added
        </span>
        <span className={`${baseClass}__legend-item ${baseClass}__legend-item--removed`}>
          <span className={`${baseClass}__legend-color`} /> Removed
        </span>
        <span className={`${baseClass}__legend-item ${baseClass}__legend-item--modified`}>
          <span className={`${baseClass}__legend-color`} /> Modified
        </span>
      </div>

      <div className={`${baseClass}__content`}>
        {isEmpty ? (
          <div className={`${baseClass}__empty`}>No changes between versions</div>
        ) : (
          <div className={`${baseClass}__panels`}>
            {/* Before Panel */}
            <div className={`${baseClass}__panel ${baseClass}__panel--before`}>
              <div className={`${baseClass}__panel-header`}>
                <span className={`${baseClass}__panel-label`}>Before</span>
                <span className={`${baseClass}__panel-version`}>v{beforeVersion}</span>
              </div>
              <div className={`${baseClass}__panel-content`}>
                <Render
                  config={beforeConfig as Parameters<typeof Render>[0]['config']}
                  data={beforeData as Parameters<typeof Render>[0]['data']}
                />
              </div>
            </div>

            {/* After Panel */}
            <div className={`${baseClass}__panel ${baseClass}__panel--after`}>
              <div className={`${baseClass}__panel-header`}>
                <span className={`${baseClass}__panel-label`}>After</span>
                <span className={`${baseClass}__panel-version`}>v{afterVersion}</span>
              </div>
              <div className={`${baseClass}__panel-content`}>
                <Render
                  config={afterConfig as Parameters<typeof Render>[0]['config']}
                  data={afterData as Parameters<typeof Render>[0]['data']}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
