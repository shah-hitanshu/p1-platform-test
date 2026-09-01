import React from 'react';
import type { P1FeaturePlugin, P1FeaturePluginDeps, PuckContribution } from '../core/plugin-types.js';
import type { P1FeatureConfig } from '../core/featureConfig.js';

const DEFAULT_PRIORITY = 100;

// A new plugin array identity remounts every Puck override component, and
// `resolveActivePlugins` returns a fresh array on every resolve — so the
// no-contributions case shares one.
const NO_CONTRIBUTIONS: readonly PuckContribution[] = [];

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
