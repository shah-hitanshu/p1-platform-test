import type { CSSFeaturePlugin } from '../core/plugin-types.js';

export const agentPlugin: CSSFeaturePlugin = {
  name: 'agent',
  featureFlags: ['agentModeEnabled'],
  priority: 60,
};
