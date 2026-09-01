/**
 * Plugin Registration System Tests
 *
 * Tests for P1FeaturePlugin interface, plugin composition engine,
 * and built-in feature plugins.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import type { P1FeaturePlugin, P1FeaturePluginDeps } from '../core/plugin-types.js';
import { resolveFeatureConfig } from '../core/featureConfig.js';
import {
  resolveActivePlugins,
  composeProviders,
  collectPuckPlugins,
} from '../editor/composePlugins.js';

const makeDeps = (overrides?: Partial<P1FeaturePluginDeps>): P1FeaturePluginDeps => ({
  client: {} as P1FeaturePluginDeps['client'],
  siteId: 'site-1',
  branchId: 'branch-1',
  userId: 'user-1',
  config: resolveFeatureConfig({}),
  ...overrides,
});

// ---------------------------------------------------------------------------
// B.2: Plugin composition engine
// ---------------------------------------------------------------------------

describe('resolveActivePlugins', () => {
  it('returns all plugins when no feature flags are specified', () => {
    const plugins: P1FeaturePlugin[] = [
      { name: 'a' },
      { name: 'b' },
    ];
    const config = resolveFeatureConfig({});
    const active = resolveActivePlugins(plugins, config);
    expect(active.map((p) => p.name)).toEqual(['a', 'b']);
  });

  it('filters out plugins whose feature flags are disabled', () => {
    const plugins: P1FeaturePlugin[] = [
      { name: 'presence', featureFlags: ['presenceEnabled'] },
      { name: 'agent', featureFlags: ['agentModeEnabled'] },
      { name: 'always' },
    ];
    const config = resolveFeatureConfig({ presenceEnabled: true, agentModeEnabled: false });
    const active = resolveActivePlugins(plugins, config);
    expect(active.map((p) => p.name)).toEqual(['presence', 'always']);
  });

  it('requires ALL feature flags to be true (AND logic)', () => {
    const plugins: P1FeaturePlugin[] = [
      { name: 'needs-both', featureFlags: ['presenceEnabled', 'enableRealtime'] },
    ];
    const config = resolveFeatureConfig({ presenceEnabled: true, enableRealtime: false });
    const active = resolveActivePlugins(plugins, config);
    expect(active).toHaveLength(0);
  });

  it('sorts plugins by priority (lower first)', () => {
    const plugins: P1FeaturePlugin[] = [
      { name: 'c', priority: 200 },
      { name: 'a', priority: 10 },
      { name: 'b', priority: 100 },
    ];
    const config = resolveFeatureConfig({});
    const active = resolveActivePlugins(plugins, config);
    expect(active.map((p) => p.name)).toEqual(['a', 'b', 'c']);
  });

  it('uses default priority 100 when not specified', () => {
    const plugins: P1FeaturePlugin[] = [
      { name: 'high', priority: 200 },
      { name: 'default' },
      { name: 'low', priority: 50 },
    ];
    const config = resolveFeatureConfig({});
    const active = resolveActivePlugins(plugins, config);
    expect(active.map((p) => p.name)).toEqual(['low', 'default', 'high']);
  });
});

describe('composeProviders', () => {
  it('returns identity wrapper when no plugins have providers', () => {
    const plugins: P1FeaturePlugin[] = [{ name: 'no-provider' }];
    const deps = makeDeps();
    const Composed = composeProviders(plugins, deps.config, deps);
    render(<Composed>hello</Composed>);
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('nests providers in priority order (outer first)', () => {
    const order: string[] = [];
    const makeProvider = (label: string): P1FeaturePlugin['provider'] =>
      ({ children }) => {
        order.push(label);
        return <div data-testid={label}>{children}</div>;
      };

    const plugins: P1FeaturePlugin[] = [
      { name: 'outer', priority: 10, provider: makeProvider('outer') },
      { name: 'inner', priority: 20, provider: makeProvider('inner') },
    ];
    const deps = makeDeps();
    const Composed = composeProviders(plugins, deps.config, deps);
    render(<Composed>content</Composed>);
    expect(screen.getByText('content')).toBeTruthy();
    expect(order).toEqual(['outer', 'inner']);
  });
});

describe('collectPuckPlugins', () => {
  it('aggregates puck plugins from all feature plugins', () => {
    const plugins: P1FeaturePlugin[] = [
      {
        name: 'a',
        puckPlugins: () => [
          { name: 'puck-a', label: 'A', icon: null, render: () => <div /> },
        ],
      },
      {
        name: 'b',
        puckPlugins: () => [
          { name: 'puck-b', label: 'B', icon: null, render: () => <div /> },
        ],
      },
    ];
    const deps = makeDeps();
    const result = collectPuckPlugins(plugins, deps);
    expect(result.map((p) => ('name' in p ? p.name : null))).toEqual(['puck-a', 'puck-b']);
  });

  it('returns empty array when no plugins provide puck plugins', () => {
    const plugins: P1FeaturePlugin[] = [{ name: 'plain' }];
    const deps = makeDeps();
    expect(collectPuckPlugins(plugins, deps)).toEqual([]);
  });

  it('carries a plugin\'s puckOverrides as their own entry', () => {
    const plugins: P1FeaturePlugin[] = [
      {
        name: 'decorator',
        puckOverrides: () => ({
          fieldTypes: {
            text: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
          },
        }),
      },
    ];
    const collected = collectPuckPlugins(plugins, makeDeps());

    expect(collected).toHaveLength(1);
    expect(collected[0]).toHaveProperty('overrides.fieldTypes.text');
  });

  it('returns a stable reference when no plugin contributes', () => {
    const plugins: P1FeaturePlugin[] = [{ name: 'plain' }];

    // Puck rebuilds every override component when the plugin array's identity
    // changes, remounting the fields panel. deps carry branchId, so a new array
    // per branch switch would remount for nothing.
    expect(collectPuckPlugins(plugins, makeDeps())).toBe(
      collectPuckPlugins(plugins, makeDeps({ branchId: 'branch-2' })),
    );
  });
});

// ---------------------------------------------------------------------------
// B.6: Default preset
// ---------------------------------------------------------------------------

describe('createDefaultPreset', () => {
  // Dynamic import to avoid failing on missing module during red phase
  it('returns plugins array with default built-in plugins', async () => {
    const { createDefaultPreset } = await import('../editor/presets.js');
    const preset = createDefaultPreset();
    expect(preset.plugins.length).toBeGreaterThan(0);
    expect(preset.config).toBeDefined();
  });

  it('accepts additional plugins', async () => {
    const { createDefaultPreset } = await import('../editor/presets.js');
    const custom: P1FeaturePlugin = { name: 'custom' };
    const preset = createDefaultPreset([custom]);
    expect(preset.plugins.some((p) => p.name === 'custom')).toBe(true);
  });

  it('accepts config overrides', async () => {
    const { createDefaultPreset } = await import('../editor/presets.js');
    const preset = createDefaultPreset([], { presenceEnabled: false });
    expect(preset.config.presenceEnabled).toBe(false);
  });
});
