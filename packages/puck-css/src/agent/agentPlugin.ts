import type { P1FeaturePlugin } from '../core/plugin-types.js';

export const agentPlugin: P1FeaturePlugin = {
  name: 'agent',
  featureFlags: ['agentModeEnabled'],
  priority: 60,
};
