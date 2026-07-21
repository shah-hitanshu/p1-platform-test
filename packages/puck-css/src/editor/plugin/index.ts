/**
 * Puck Plugin Integration
 *
 * Exports for integrating P1 functionality directly into Puck
 * using Puck's official Plugin API and Overrides system.
 */

export { createP1Plugin } from './P1Plugin.js';
export type { P1PluginOptions, PuckPlugin } from './P1Plugin.js';

export { createP1Overrides } from './createP1Overrides.js';
export type { P1OverridesOptions, PuckOverrides } from './createP1Overrides.js';

export { createMergePreviewPlugin } from './mergePreviewPlugin.js';
export type { MergePreviewPluginOptions } from './mergePreviewPlugin.js';
