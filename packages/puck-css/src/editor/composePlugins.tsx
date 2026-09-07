import React from 'react';
import type { P1FeaturePlugin, P1FeaturePluginDeps, PuckContribution } from '../core/plugin-types.js';
import type { P1FeatureConfig } from '../core/featureConfig.js';

const DEFAULT_PRIORITY = 100;

// A new plugin array identity remounts every Puck override component, and
// `resolveActivePlugins` returns a fresh array on every resolve — so the
// no-contributions case shares one.
const NO_CONTRIBUTIONS: readonly PuckContribution[] = [];

// Same reason as NO_CONTRIBUTIONS: the header takes this array as a prop, so a
// fresh identity per render would remount the controls it holds.
const NO_TOOLBAR_ACTIONS: readonly React.ReactNode[] = [];

export function resolveActivePlugins(
  plugins: P1FeaturePlugin[],
  config: Required<P1FeatureConfig>,
): P1FeaturePlugin[] {
  return plugins
    .filter((p) => {
      if (!p.featureFlags || p.featureFlags.length === 0) return true;
      return p.featureFlags.every((flag) => config[flag]);
    })
    .sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY));
}

export function composeProviders(
  plugins: P1FeaturePlugin[],
  config: Required<P1FeatureConfig>,
  deps: P1FeaturePluginDeps,
): React.ComponentType<{ children: React.ReactNode }> {
  const withProviders = plugins.filter((p) => p.provider);
  if (withProviders.length === 0) {
    return ({ children }) => <>{children}</>;
  }

  return ({ children }) => {
    let node = <>{children}</>;
    for (let i = withProviders.length - 1; i >= 0; i--) {
      const plugin = withProviders[i];
      if (!plugin?.provider) continue;
      const Provider = plugin.provider;
      node = <Provider config={config} deps={deps}>{node}</Provider>;
    }
    return node;
  };
}

/**
 * Each plugin's panels, then an entry carrying its `puckOverrides`. Puck chains
 * `overrides` along the plugin array: an entry wraps the ones before it, with
 * the editor's own `overrides` prop innermost. A plugin's own overrides entry
 * therefore wraps its own panel entries for any shared field type key — a
 * plugin declaring both must account for that ordering.
 */
export function collectPuckPlugins(
  plugins: P1FeaturePlugin[],
  deps: P1FeaturePluginDeps,
): readonly PuckContribution[] {
  const result: PuckContribution[] = [];
  for (const p of plugins) {
    if (p.puckPlugins) {
      result.push(...p.puckPlugins(deps));
    }
    if (p.puckOverrides) {
      result.push({ overrides: p.puckOverrides(deps) });
    }
  }
  return result.length === 0 ? NO_CONTRIBUTIONS : result;
}

/**
 * The toolbar controls the given plugins contribute, in the order the plugins
 * arrive — pass them already sorted to place them by priority.
 */
export function collectToolbarActions(
  plugins: P1FeaturePlugin[],
  deps: P1FeaturePluginDeps,
): readonly React.ReactNode[] {
  const result: React.ReactNode[] = [];
  for (const p of plugins) {
    if (!p.toolbarActions) continue;
    const action = p.toolbarActions(deps);
    // A feature that renders nothing still occupies a slot the toolbar would
    // space and separate, so it is dropped rather than passed along empty.
    if (action === null || action === undefined || action === false) continue;
    // Keyed here rather than by the toolbar, which renders the array as given and
    // has no name to key by.
    result.push(<React.Fragment key={p.name}>{action}</React.Fragment>);
  }
  return result.length === 0 ? NO_TOOLBAR_ACTIONS : result;
}
