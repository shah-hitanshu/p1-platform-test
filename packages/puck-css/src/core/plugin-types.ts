import type React from 'react';
import type { CSSClient } from '@pantheon-systems/css-client';
import type { CSSFeatureConfig } from './featureConfig.js';

export interface CSSFeaturePluginDeps {
  client: CSSClient;
  siteId: string;
  branchId: string;
  userId: string;
  config: Required<CSSFeatureConfig>;
}

export interface PuckPluginDef {
  name: string;
  label: string;
  icon: React.ReactNode;
  render: () => React.ReactElement;
  overrides?: Record<string, unknown>;
}

export interface CSSFeaturePlugin {
  name: string;
  featureFlags?: (keyof CSSFeatureConfig)[];
  priority?: number;
  provider?: React.ComponentType<{
    children: React.ReactNode;
    config: Required<CSSFeatureConfig>;
    deps: CSSFeaturePluginDeps;
  }>;
  puckPlugins?: (deps: CSSFeaturePluginDeps) => PuckPluginDef[];
  puckOverrides?: (deps: CSSFeaturePluginDeps) => Record<string, unknown>;
}
