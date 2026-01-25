/**
 * Highlighted Config Utility
 *
 * Creates a Puck config wrapper that adds visual diff highlighting to components.
 */

import React from 'react';
import type { ComponentDiffWithPosition } from '../types.js';

/**
 * Puck Config structure (flexible to accept Puck's Config type)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PuckConfig = Record<string, any>;

/**
 * Creates a map of component IDs to their diff types.
 */
export function createDiffMap(
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
 *
 * @param config - The original Puck config
 * @param diffMap - Map of component IDs to their diff types
 * @param side - Which side of the comparison ('before' shows removed/modified, 'after' shows added/modified)
 * @returns A new config with wrapped render functions that add visual highlighting
 */
export function createHighlightedConfig(
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

        return React.createElement(
          'div',
          {
            className: `visual-diff-highlight visual-diff-highlight--${diffType}`,
            'data-diff-type': diffType,
            'data-component-id': id,
          },
          renderedContent,
          React.createElement(
            'div',
            { className: `visual-diff-badge visual-diff-badge--${diffType}` },
            diffType === 'added' ? '+' : diffType === 'removed' ? '−' : '~'
          )
        );
      },
    };
  }

  return { ...config, components: wrappedComponents };
}

/**
 * Creates a highlighted config for viewing historical versions.
 * Shows what has changed between the historical version and the current version.
 *
 * When viewing an old version:
 * - Removed components (in old but not current) are shown with red highlight
 * - Modified components are shown with yellow highlight
 * - Added components (in current but not old) are not shown (they don't exist in old version)
 *
 * @param config - The original Puck config
 * @param diffs - Array of component diffs
 * @returns A new config with diff highlighting for the 'before' side
 */
export function createHistoricalVersionConfig(
  config: PuckConfig,
  diffs: ComponentDiffWithPosition[]
): PuckConfig {
  const diffMap = createDiffMap(diffs);
  return createHighlightedConfig(config, diffMap, 'before');
}
