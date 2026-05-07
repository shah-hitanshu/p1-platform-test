import type { CSSFeaturePlugin } from '../core/plugin-types.js';

export const collaborationPlugin: CSSFeaturePlugin = {
  name: 'collaboration',
  featureFlags: ['presenceEnabled'],
  priority: 50,
};
