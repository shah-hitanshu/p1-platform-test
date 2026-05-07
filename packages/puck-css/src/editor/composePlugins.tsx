import React from 'react';
import type { CSSFeaturePlugin, CSSFeaturePluginDeps, PuckPluginDef } from '../core/plugin-types.js';
import type { CSSFeatureConfig } from '../core/featureConfig.js';

const DEFAULT_PRIORITY = 100;

export function resolveActivePlugins(
  plugins: CSSFeaturePlugin[],
  config: Required<CSSFeatureConfig>,
): CSSFeaturePlugin[] {
  return plugins
    .filter((p) => {
      if (!p.featureFlags || p.featureFlags.length === 0) return true;
      return p.featureFlags.every((flag) => config[flag]);
    })
    .sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY));
}

export function composeProviders(
  plugins: CSSFeaturePlugin[],
  config: Required<CSSFeatureConfig>,
  deps: CSSFeaturePluginDeps,
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

export function collectPuckPlugins(
  plugins: CSSFeaturePlugin[],
  deps: CSSFeaturePluginDeps,
): PuckPluginDef[] {
  const result: PuckPluginDef[] = [];
  for (const p of plugins) {
    if (p.puckPlugins) {
      result.push(...p.puckPlugins(deps));
    }
  }
  return result;
}

export function mergeOverrides(
  plugins: CSSFeaturePlugin[],
  deps: CSSFeaturePluginDeps,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const p of plugins) {
    if (p.puckOverrides) {
      Object.assign(result, p.puckOverrides(deps));
    }
  }
  return result;
}
