/**
 * Puck Plugin Integration
 *
 * Exports for integrating CSS functionality directly into Puck
 * using Puck's official Plugin API and Overrides system.
 */

export { createCSSPlugin } from './CSSPlugin.js';
export type { CSSPluginOptions, PuckPlugin } from './CSSPlugin.js';

export { createCSSOverrides } from './createCSSOverrides.js';
export type { CSSOverridesOptions, PuckOverrides } from './createCSSOverrides.js';
