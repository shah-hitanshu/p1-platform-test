import type { CSSFeaturePlugin } from '../core/plugin-types.js';
import type { CSSFeatureConfig } from '../core/featureConfig.js';
import { resolveFeatureConfig } from '../core/featureConfig.js';
import { DEFAULT_CSS_FEATURE_PLUGINS } from './defaultPlugins.js';

export interface CSSPreset {
  plugins: CSSFeaturePlugin[];
  config: Required<CSSFeatureConfig>;
}

export function createDefaultPreset(
  additionalPlugins?: CSSFeaturePlugin[],
  configOverrides?: CSSFeatureConfig,
): CSSPreset {
  const baseConfig: CSSFeatureConfig = {
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
    plugins: [...DEFAULT_CSS_FEATURE_PLUGINS, ...(additionalPlugins ?? [])],
    config: resolveFeatureConfig(baseConfig),
  };
}
