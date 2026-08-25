/**
 * B.4: P1PuckProvider Plugin Wiring Tests
 *
 * Tests that P1PuckProvider accepts featurePlugins and featureConfig props,
 * uses the composition engine to filter/sort/compose plugin providers, and
 * maintains backwards compatibility when the new props are omitted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { P1FeaturePlugin } from '../core/plugin-types.js';

// ---------------------------------------------------------------------------
// Mock heavy dependencies (same pattern as connectedDocumentPath-ref.test)
// ---------------------------------------------------------------------------

const mockRealtimeState = {
  connected: false,
  connectedDocumentPath: null as string | null,
  applyLocalChange: vi.fn(),
  getSnapshot: vi.fn().mockReturnValue(null),
  error: null,
  sendFocusRegions: vi.fn().mockReturnValue(false),
  sendHeartbeat: vi.fn(),
  presenceViaWebSocket: false,
  waitForDelivery: vi.fn().mockResolvedValue(undefined),
  requestPublish: vi.fn().mockResolvedValue({ success: true }),
};

vi.mock('../editor/useRealtime', () => ({
  useRealtime: () => ({ ...mockRealtimeState }),
}));

vi.mock('../editor/useDocuments', () => ({
  useDocuments: () => ({
    documents: [],
    loading: false,
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));

const mockClientMethods = {
  documents: { getByPath: vi.fn(), publish: vi.fn() },
  versions: { getLatest: vi.fn(), get: vi.fn(), create: vi.fn() },
  branches: { list: vi.fn().mockResolvedValue([]) },
  checkpoints: { create: vi.fn() },
  presence: { getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }) },
  agentEdit: {
    canEdit: vi.fn(),
    startEdit: vi.fn(),
    completeEdit: vi.fn(),
    abortEdit: vi.fn(),
    stopAgent: vi.fn(),
  },
  sites: { get: vi.fn().mockResolvedValue({ name: 'Test Site' }) },
  withPrincipal: vi.fn(),
};
mockClientMethods.withPrincipal.mockReturnValue(mockClientMethods);

vi.mock('../core/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotifications: () => ({
    addNotification: vi.fn(),
    addError: vi.fn(),
    addSuccess: vi.fn(),
    addWarning: vi.fn(),
    addInfo: vi.fn(),
    notifications: [],
    removeNotification: vi.fn(),
    clearNotifications: vi.fn(),
  }),
}));

import { P1PuckProvider } from '../editor/P1PuckProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockClient = mockClientMethods as unknown as Parameters<typeof P1PuckProvider>[0]['client'];

const baseProps = {
  client: mockClient,
  siteId: 'site-1',
  branchId: 'branch-1',
  userId: 'user-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// B.4.1: P1PuckProvider accepts featurePlugins prop
// ---------------------------------------------------------------------------

describe('P1PuckProvider plugin wiring', () => {
  it('renders plugin providers when featurePlugins are provided', () => {
    const plugin: P1FeaturePlugin = {
      name: 'test-plugin',
      provider: ({ children }) => (
        <div data-testid="test-plugin-provider">{children}</div>
      ),
    };

    render(
      <P1PuckProvider {...baseProps} featurePlugins={[plugin]}>
        <div data-testid="child">hello</div>
      </P1PuckProvider>,
    );

    expect(screen.getByTestId('test-plugin-provider')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('renders multiple plugin providers in priority order', () => {
    const renderOrder: string[] = [];

    const outerPlugin: P1FeaturePlugin = {
      name: 'outer',
      priority: 10,
      provider: ({ children }) => {
        renderOrder.push('outer');
        return <div data-testid="outer-provider">{children}</div>;
      },
    };

    const innerPlugin: P1FeaturePlugin = {
      name: 'inner',
      priority: 20,
      provider: ({ children }) => {
        renderOrder.push('inner');
        return <div data-testid="inner-provider">{children}</div>;
      },
    };

    render(
      <P1PuckProvider {...baseProps} featurePlugins={[innerPlugin, outerPlugin]}>
        <div data-testid="child">content</div>
      </P1PuckProvider>,
    );

    expect(screen.getByTestId('outer-provider')).toBeTruthy();
    expect(screen.getByTestId('inner-provider')).toBeTruthy();
    // Verify correct nesting order: outer wraps inner
    const outerEl = screen.getByTestId('outer-provider');
    const innerEl = screen.getByTestId('inner-provider');
    expect(outerEl.contains(innerEl)).toBe(true);
  });

  it('does not render providers for plugins without a provider component', () => {
    const pluginNoProvider: P1FeaturePlugin = { name: 'no-provider' };
    const pluginWithProvider: P1FeaturePlugin = {
      name: 'with-provider',
      provider: ({ children }) => (
        <div data-testid="has-provider">{children}</div>
      ),
    };

    render(
      <P1PuckProvider {...baseProps} featurePlugins={[pluginNoProvider, pluginWithProvider]}>
        <div data-testid="child">hello</div>
      </P1PuckProvider>,
    );

    expect(screen.getByTestId('has-provider')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// B.4.2: featureConfig filters plugins
// ---------------------------------------------------------------------------

describe('P1PuckProvider featureConfig filtering', () => {
  it('filters out plugins whose feature flags are disabled', () => {
    const enabledPlugin: P1FeaturePlugin = {
      name: 'enabled',
      featureFlags: ['enableVersionHistory'],
      provider: ({ children }) => (
        <div data-testid="enabled-provider">{children}</div>
      ),
    };

    const disabledPlugin: P1FeaturePlugin = {
      name: 'disabled',
      featureFlags: ['enableMergeControl'],
      provider: ({ children }) => (
        <div data-testid="disabled-provider">{children}</div>
      ),
    };

    render(
      <P1PuckProvider
        {...baseProps}
        featurePlugins={[enabledPlugin, disabledPlugin]}
        featureConfig={{ enableVersionHistory: true, enableMergeControl: false }}
      >
        <div data-testid="child">hello</div>
      </P1PuckProvider>,
    );

    expect(screen.getByTestId('enabled-provider')).toBeTruthy();
    expect(screen.queryByTestId('disabled-provider')).toBeNull();
  });

  it('uses AND logic for multiple feature flags', () => {
    const plugin: P1FeaturePlugin = {
      name: 'needs-both',
      featureFlags: ['presenceEnabled', 'enableCollaboratorAvatars'],
      provider: ({ children }) => (
        <div data-testid="needs-both-provider">{children}</div>
      ),
    };

    render(
      <P1PuckProvider
        {...baseProps}
        featurePlugins={[plugin]}
        featureConfig={{ presenceEnabled: true, enableCollaboratorAvatars: false }}
      >
        <div data-testid="child">hello</div>
      </P1PuckProvider>,
    );

    expect(screen.queryByTestId('needs-both-provider')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B.4.3: Default behavior without new props
// ---------------------------------------------------------------------------

describe('P1PuckProvider backwards compatibility', () => {
  it('renders children without new props', () => {
    render(
      <P1PuckProvider {...baseProps}>
        <div data-testid="child">hello</div>
      </P1PuckProvider>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('derives featureConfig from existing boolean props', () => {
    const plugin: P1FeaturePlugin = {
      name: 'presence-plugin',
      featureFlags: ['presenceEnabled'],
      provider: ({ children }) => (
        <div data-testid="presence-provider">{children}</div>
      ),
    };

    // When presenceEnabled=false via the existing prop, the plugin should be filtered out
    render(
      <P1PuckProvider {...baseProps} presenceEnabled={false} featurePlugins={[plugin]}>
        <div data-testid="child">hello</div>
      </P1PuckProvider>,
    );

    expect(screen.queryByTestId('presence-provider')).toBeNull();
  });

  it('uses default plugins when featurePlugins is not provided', () => {
    // DEFAULT_CCR_FEATURE_PLUGINS has collaborationPlugin and agentPlugin
    // Neither has a provider, so this just tests no crash
    render(
      <P1PuckProvider {...baseProps}>
        <div data-testid="child">hello</div>
      </P1PuckProvider>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// B.4.4: Plugin providers receive correct deps
// ---------------------------------------------------------------------------

describe('P1PuckProvider plugin deps', () => {
  it('passes config and deps to plugin providers', () => {
    let receivedConfig: unknown = null;
    let receivedDeps: unknown = null;

    const plugin: P1FeaturePlugin = {
      name: 'deps-check',
      provider: ({ children, config, deps }) => {
        receivedConfig = config;
        receivedDeps = deps;
        return <>{children}</>;
      },
    };

    render(
      <P1PuckProvider {...baseProps} featurePlugins={[plugin]}>
        <div>hello</div>
      </P1PuckProvider>,
    );

    expect(receivedConfig).toBeDefined();
    expect(receivedConfig).toHaveProperty('presenceEnabled');
    expect(receivedConfig).toHaveProperty('enableRealtime');
    expect(receivedDeps).toBeDefined();
    expect(receivedDeps).toHaveProperty('siteId', 'site-1');
    expect(receivedDeps).toHaveProperty('branchId', 'branch-1');
    expect(receivedDeps).toHaveProperty('userId', 'user-1');
    expect(receivedDeps).toHaveProperty('client');
  });
});
