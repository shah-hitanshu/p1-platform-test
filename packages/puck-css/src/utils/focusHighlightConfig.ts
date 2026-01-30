/**
 * Focus Highlight Config Utility
 *
 * Creates a Puck config wrapper that adds visual focus highlighting
 * to show which components other actors are viewing or editing.
 *
 * IMPORTANT: This utility supports two modes:
 * 1. Context-based (preferred): Create config once, use FocusHighlightProvider to update highlights
 * 2. Direct focusMap (legacy): Pass focusMap directly, config recreated on each change
 *
 * The context-based approach prevents Puck re-renders when focus regions change.
 */

import React from 'react';
import type { FocusHighlight } from './focusRegionMap.js';
import { FocusHighlightContext } from '../FocusHighlightContext.js';

/**
 * Puck Config structure (flexible to accept Puck's Config type)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PuckConfig = Record<string, any>;

/**
 * Component wrapper that renders focus highlight from context.
 * This allows the highlight to change without recreating the config.
 */
function FocusHighlightWrapper({
  id,
  children,
  staticFocus,
}: {
  id: string;
  children: React.ReactNode;
  staticFocus?: FocusHighlight;
}): React.ReactElement {
  // Try context first (for dynamic updates without config recreation)
  const context = React.useContext(FocusHighlightContext);
  const focus = context?.focusMap.get(id) ?? staticFocus;

  // No focus on this component - pass through
  if (!focus) {
    return React.createElement(React.Fragment, null, children);
  }

  // Build class name
  const className = focus.isEditing
    ? 'focus-region-highlight focus-region-highlight--editing'
    : 'focus-region-highlight';

  // Wrap with focus highlight
  return React.createElement(
    'div',
    {
      className,
      style: { '--focus-color': focus.color } as React.CSSProperties,
      'data-actor-id': focus.actorId,
    },
    children,
    React.createElement(
      'div',
      { className: 'focus-region-highlight__badge' },
      focus.actorName.charAt(0).toUpperCase()
    )
  );
}

/**
 * Creates a Puck config with focus highlight wrappers.
 *
 * When used with FocusHighlightProvider (context mode), the config only needs
 * to be created once - highlights update via context without config recreation.
 *
 * When used without FocusHighlightProvider (legacy mode), pass focusMap directly
 * but this will cause config recreation on every focusMap change.
 *
 * @param config - The original Puck config
 * @param focusMap - Optional static focusMap for legacy mode (prefer using context instead)
 * @returns A new config with wrapped render functions that add focus highlighting
 *
 * @example Context mode (preferred - no flicker):
 * ```tsx
 * // Create config once with no focusMap
 * const highlightedConfig = useMemo(
 *   () => createFocusHighlightConfig(baseConfig),
 *   [baseConfig]
 * );
 *
 * // Wrap Puck with provider that can update without config recreation
 * <FocusHighlightProvider focusMap={focusMap}>
 *   <Puck config={highlightedConfig} data={data} />
 * </FocusHighlightProvider>
 * ```
 *
 * @example Legacy mode (may cause flicker):
 * ```tsx
 * const focusMap = createFocusRegionMap(puckData, otherActors);
 * const highlightedConfig = createFocusHighlightConfig(baseConfig, focusMap);
 *
 * <Puck config={highlightedConfig} data={data} />
 * ```
 */
export function createFocusHighlightConfig(
  config: PuckConfig,
  focusMap?: Map<string, FocusHighlight>
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
        const renderedContent = originalRender(props);

        // Use wrapper component for context-based focus detection
        // Pass static focus for legacy mode fallback
        return React.createElement(
          FocusHighlightWrapper,
          {
            id,
            staticFocus: focusMap?.get(id),
            children: renderedContent,
          }
        );
      },
    };
  }

  return { ...config, components: wrappedComponents };
}
