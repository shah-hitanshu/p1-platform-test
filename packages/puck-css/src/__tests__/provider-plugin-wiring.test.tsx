/**
 * B.4: CSSPuckProvider Plugin Wiring Tests
 *
 * Tests that CSSPuckProvider accepts featurePlugins and featureConfig props,
 * uses the composition engine to filter/sort/compose plugin providers, and
 * maintains backwards compatibility when the new props are omitted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { CSSFeaturePlugin } from '../core/plugin-types.js';

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

import { CSSPuckProvider } from '../editor/CSSPuckProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockClient = mockClientMethods as unknown as Parameters<typeof CSSPuckProvider>[0]['client'];

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
// B.4.1: CSSPuckProvider accepts featurePlugins prop
// ---------------------------------------------------------------------------

describe('CSSPuckProvider plugin wiring', () => {
  it('renders plugin providers when featurePlugins are provided', () => {
    const plugin: CSSFeaturePlugin = {
      name: 'test-plugin',
      provider: ({ children }) => (
        <div data-testid="test-plugin-provider">{children}</div>
      ),
    };

    render(
      <CSSPuckProvider {...baseProps} featurePlugins={[plugin]}>
        <div data-testid="child">hello</div>
      </CSSPuckProvider>,
    );

    expect(screen.getByTestId('test-plugin-provider')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('renders multiple plugin providers in priority order', () => {
    const renderOrder: string[] = [];

    const outerPlugin: CSSFeaturePlugin = {
      name: 'outer',
      priority: 10,
      provider: ({ children }) => {
        renderOrder.push('outer');
        return <div data-testid="outer-provider">{children}</div>;
      },
    };

    const innerPlugin: CSSFeaturePlugin = {
      name: 'inner',
      priority: 20,
      provider: ({ children }) => {
        renderOrder.push('inner');
        return <div data-testid="inner-provider">{children}</div>;
      },
    };

    render(
      <CSSPuckProvider {...baseProps} featurePlugins={[innerPlugin, outerPlugin]}>
        <div data-testid="child">content</div>
      </CSSPuckProvider>,
    );

    expect(screen.getByTestId('outer-provider')).toBeTruthy();
    expect(screen.getByTestId('inner-provider')).toBeTruthy();
    // Verify correct nesting order: outer wraps inner
    const outerEl = screen.getByTestId('outer-provider');
    const innerEl = screen.getByTestId('inner-provider');
    expect(outerEl.contains(innerEl)).toBe(true);
  });

  it('does not render providers for plugins without a provider component', () => {
    const pluginNoProvider: CSSFeaturePlugin = { name: 'no-provider' };
    const pluginWithProvider: CSSFeaturePlugin = {
      name: 'with-provider',
      provider: ({ children }) => (
        <div data-testid="has-provider">{children}</div>
      ),
    };

    render(
      <CSSPuckProvider {...baseProps} featurePlugins={[pluginNoProvider, pluginWithProvider]}>
        <div data-testid="child">hello</div>
      </CSSPuckProvider>,
    );

    expect(screen.getByTestId('has-provider')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// B.4.2: featureConfig filters plugins
// ---------------------------------------------------------------------------

describe('CSSPuckProvider featureConfig filtering', () => {
  it('filters out plugins whose feature flags are disabled', () => {
    const enabledPlugin: CSSFeaturePlugin = {
      name: 'enabled',
      featureFlags: ['enableVersionHistory'],
      provider: ({ children }) => (
        <div data-testid="enabled-provider">{children}</div>
      ),
    };

    const disabledPlugin: CSSFeaturePlugin = {
      name: 'disabled',
      featureFlags: ['enableMergeControl'],
      provider: ({ children }) => (
        <div data-testid="disabled-provider">{children}</div>
      ),
    };

    render(
      <CSSPuckProvider
        {...baseProps}
        featurePlugins={[enabledPlugin, disabledPlugin]}
        featureConfig={{ enableVersionHistory: true, enableMergeControl: false }}
      >
        <div data-testid="child">hello</div>
      </CSSPuckProvider>,
    );

    expect(screen.getByTestId('enabled-provider')).toBeTruthy();
    expect(screen.queryByTestId('disabled-provider')).toBeNull();
  });

  it('uses AND logic for multiple feature flags', () => {
    const plugin: CSSFeaturePlugin = {
      name: 'needs-both',
      featureFlags: ['presenceEnabled', 'enableCollaboratorAvatars'],
      provider: ({ children }) => (
        <div data-testid="needs-both-provider">{children}</div>
      ),
    };

    render(
      <CSSPuckProvider
        {...baseProps}
        featurePlugins={[plugin]}
        featureConfig={{ presenceEnabled: true, enableCollaboratorAvatars: false }}
      >
        <div data-testid="child">hello</div>
      </CSSPuckProvider>,
    );

    expect(screen.queryByTestId('needs-both-provider')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B.4.3: Default behavior without new props
// ---------------------------------------------------------------------------

describe('CSSPuckProvider backwards compatibility', () => {
  it('renders children without new props', () => {
    render(
      <CSSPuckProvider {...baseProps}>
        <div data-testid="child">hello</div>
      </CSSPuckProvider>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('derives featureConfig from existing boolean props', () => {
    const plugin: CSSFeaturePlugin = {
      name: 'presence-plugin',
      featureFlags: ['presenceEnabled'],
      provider: ({ children }) => (
        <div data-testid="presence-provider">{children}</div>
      ),
    };

    // When presenceEnabled=false via the existing prop, the plugin should be filtered out
    render(
      <CSSPuckProvider {...baseProps} presenceEnabled={false} featurePlugins={[plugin]}>
        <div data-testid="child">hello</div>
      </CSSPuckProvider>,
    );

    expect(screen.queryByTestId('presence-provider')).toBeNull();
  });

  it('uses default plugins when featurePlugins is not provided', () => {
    // DEFAULT_CSS_FEATURE_PLUGINS has collaborationPlugin and agentPlugin
    // Neither has a provider, so this just tests no crash
    render(
      <CSSPuckProvider {...baseProps}>
        <div data-testid="child">hello</div>
      </CSSPuckProvider>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// B.4.4: Plugin providers receive correct deps
// ---------------------------------------------------------------------------

describe('CSSPuckProvider plugin deps', () => {
  it('passes config and deps to plugin providers', () => {
    let receivedConfig: unknown = null;
    let receivedDeps: unknown = null;

    const plugin: CSSFeaturePlugin = {
      name: 'deps-check',
      provider: ({ children, config, deps }) => {
        receivedConfig = config;
        receivedDeps = deps;
        return <>{children}</>;
      },
    };

    render(
      <CSSPuckProvider {...baseProps} featurePlugins={[plugin]}>
        <div>hello</div>
      </CSSPuckProvider>,
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
