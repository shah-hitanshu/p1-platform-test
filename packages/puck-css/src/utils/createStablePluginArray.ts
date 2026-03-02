/**
 * createStablePluginArray
 *
 * Creates a memoized plugin array that only changes identity when
 * the plugin references change. Filters out null/undefined entries.
 */

import type { PuckPlugin } from '../plugin/CSSPlugin.js';

let lastPlugins: PuckPlugin[] = [];
let lastResult: PuckPlugin[] = [];

/**
 * Creates a stable plugin array from the given plugins.
 *
 * Returns the same array reference if the same plugin instances
 * are passed in the same order. Filters out null/undefined entries.
 *
 * This is useful for consumers who manually assemble plugin arrays
 * outside of useCSSEditor and want to avoid unnecessary Puck re-renders.
 *
 * @param plugins - Plugin instances to include
 * @returns A stable array of non-null plugins
 *
 * @example
 * ```tsx
 * const plugins = createStablePluginArray(cssPlugin, aiPlugin, pccPlugin);
 * return <Puck plugins={plugins} />;
 * ```
 */
export function createStablePluginArray(...plugins: PuckPlugin[]): PuckPlugin[] {
  // Filter out null/undefined
  const filtered = plugins.filter(Boolean);

  // Check if the plugins are the same as last call
  if (
    filtered.length === lastPlugins.length &&
    filtered.every((p, i) => p === lastPlugins[i])
  ) {
    return lastResult;
  }

  // Cache and return new array
  lastPlugins = filtered;
  lastResult = [...filtered];
  return lastResult;
}
