import type React from 'react';
import type { P1Client } from '@pantheon-systems/css-client';
import type { P1FeatureConfig } from './featureConfig.js';

/**
 * A live view of the editor's context, stable for the editor's lifetime.
 * `puckPlugins` and `puckOverrides` run once, so hold onto `deps` and read
 * through it while rendering — a value lifted into a local in the function body
 * keeps whatever it was on the first render.
 */
export interface P1FeaturePluginDeps {
  client: P1Client;
  siteId: string;
  branchId: string;
  userId: string;
  config: Required<P1FeatureConfig>;
}

export interface PuckPluginDef {
  name: string;
  label: string;
  icon: React.ReactNode;
  render: () => React.ReactElement;
  overrides?: Record<string, unknown>;
}

export type PuckContribution = PuckPluginDef | { overrides: Record<string, unknown> };

export interface P1FeaturePlugin {
  name: string;
  featureFlags?: (keyof P1FeatureConfig)[];
  priority?: number;
  provider?: React.ComponentType<{
    children: React.ReactNode;
    config: Required<P1FeatureConfig>;
    deps: P1FeaturePluginDeps;
  }>;
  puckPlugins?: (deps: P1FeaturePluginDeps) => PuckPluginDef[];
  puckOverrides?: (deps: P1FeaturePluginDeps) => Record<string, unknown>;
}
