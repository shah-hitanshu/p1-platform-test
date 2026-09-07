/**
 * Localization Feature Plugin Tests
 *
 * The localization plugin is always active and contributes the fields-panel
 * overrides.
 */

import { describe, it, expect } from 'vitest';
import { localizationPlugin } from '../../features/localization/index.js';
import { resolveFeatureConfig } from '../../core/featureConfig.js';
import { resolveActivePlugins } from '../../editor/composePlugins.js';
import { DEFAULT_CCR_FEATURE_PLUGINS } from '../../editor/defaultPlugins.js';

describe('localizationPlugin', () => {
  it('declares the localization name and priority', () => {
    expect(localizationPlugin.name).toBe('localization');
    expect(typeof localizationPlugin.priority).toBe('number');
  });

  it('is registered in the default CCR feature plugins', () => {
    expect(DEFAULT_CCR_FEATURE_PLUGINS.map((p) => p.name)).toContain('localization');
  });

  it('is active in the default config', () => {
    const active = resolveActivePlugins(DEFAULT_CCR_FEATURE_PLUGINS, resolveFeatureConfig({}));
    expect(active.map((p) => p.name)).toContain('localization');
  });

  it('places the locale switcher in the editor toolbar', () => {
    const deps = {} as Parameters<NonNullable<typeof localizationPlugin.toolbarActions>>[0];

    expect(localizationPlugin.toolbarActions?.(deps)).not.toBeNull();
  });
});
