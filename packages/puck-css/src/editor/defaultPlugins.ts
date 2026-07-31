import type { P1FeaturePlugin } from '../core/plugin-types.js';
import { collaborationPlugin } from '../collaboration/collaborationPlugin.js';
import { agentPlugin } from '../agent/agentPlugin.js';

export const DEFAULT_CSS_FEATURE_PLUGINS: P1FeaturePlugin[] = [
  collaborationPlugin,
  agentPlugin,
];
