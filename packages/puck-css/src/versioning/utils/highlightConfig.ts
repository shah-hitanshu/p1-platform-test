/**
 * Highlighted Config Utility
 *
 * Creates a Puck config wrapper that adds visual diff highlighting to components.
 *
 * All visual styling uses inline React styles. BEM class names are retained
 * as secondary identifiers for DOM querying and test assertions.
 */

import React from 'react';
import type { ComponentDiffWithPosition } from '../../core/types.js';

/**
 * Puck Config structure (flexible to accept Puck's Config type)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PuckConfig = Record<string, any>;

// =============================================================================
// Inline Style Constants
// =============================================================================

const highlightStyles: Record<string, React.CSSProperties> = {
  added: {
    border: '2px solid #22c55e',
    borderRadius: '4px',
    position: 'relative',
  },
  removed: {
    border: '2px solid #ef4444',
    borderRadius: '4px',
    position: 'relative',
    opacity: 0.6,
  },
  modified: {
    border: '2px solid #eab308',
    borderRadius: '4px',
    position: 'relative',
  },
};

const badgeBaseStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-8px',
  right: '-8px',
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '12px',
  fontWeight: 700,
  color: '#fff',
};

const badgeBackgrounds: Record<string, string> = {
  added: '#22c55e',
  removed: '#ef4444',
  modified: '#eab308',
};

// =============================================================================
// Utilities
// =============================================================================

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

        const wrapperInlineStyle = highlightStyles[diffType] || {};
        const badgeInlineStyle: React.CSSProperties = {
          ...badgeBaseStyle,
          background: badgeBackgrounds[diffType] || '#999',
        };

        return React.createElement(
          'div',
          {
            className: `visual-diff-highlight visual-diff-highlight--${diffType}`,
            style: wrapperInlineStyle,
            'data-diff-type': diffType,
            'data-component-id': id,
          },
          renderedContent,
          React.createElement(
            'div',
            {
              className: `visual-diff-badge visual-diff-badge--${diffType}`,
              style: badgeInlineStyle,
            },
            diffType === 'added' ? '+' : diffType === 'removed' ? '\u2212' : '~'
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
