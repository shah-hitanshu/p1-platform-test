import type { P1FeaturePlugin } from '../core/plugin-types.js';
import type { P1FeatureConfig } from '../core/featureConfig.js';
import { resolveFeatureConfig } from '../core/featureConfig.js';
import { DEFAULT_CCR_FEATURE_PLUGINS } from './defaultPlugins.js';

export interface P1Preset {
  plugins: P1FeaturePlugin[];
  config: Required<P1FeatureConfig>;
}

export function createDefaultPreset(
  additionalPlugins?: P1FeaturePlugin[],
  configOverrides?: P1FeatureConfig,
): P1Preset {
  const baseConfig: P1FeatureConfig = {
    enableRealtime: true,
    presenceEnabled: true,
    agentModeEnabled: true,
    enableDocumentBrowser: true,
    enableBranchSelector: true,
    enableVersionHistory: true,
    enableMergeControl: true,
    enableAutoSave: true,
    enablePublishButton: true,
    enableCollaboratorAvatars: true,
    enableAgentBanner: true,
    enableFocusHighlighting: true,
    ...configOverrides,
  };

  return {
    plugins: [...DEFAULT_CCR_FEATURE_PLUGINS, ...(additionalPlugins ?? [])],
    config: resolveFeatureConfig(baseConfig),
  };
}
