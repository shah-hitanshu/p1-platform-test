import type React from 'react';
import type { P1Client } from '@pantheon-systems/css-client';
import type { P1FeatureConfig } from './featureConfig.js';

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
