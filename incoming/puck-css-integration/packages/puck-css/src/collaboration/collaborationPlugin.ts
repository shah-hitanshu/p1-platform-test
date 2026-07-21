import type { P1FeaturePlugin } from '../core/plugin-types.js';

export const collaborationPlugin: P1FeaturePlugin = {
  name: 'collaboration',
  featureFlags: ['presenceEnabled'],
  priority: 50,
};
