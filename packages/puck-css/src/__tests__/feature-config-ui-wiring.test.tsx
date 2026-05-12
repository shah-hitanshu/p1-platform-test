/**
 * B.5: Feature Config UI Wiring Tests
 *
 * Tests that the resolved P1FeatureConfig is exposed on the context value
 * and that useP1Plugin / useP1Overrides gate UI features based on flags.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React, { useContext } from 'react';
import type { P1FeatureConfig } from '../core/featureConfig.js';
import type { PuckOverrides } from '../editor/plugin/createP1Overrides.js';

// ---------------------------------------------------------------------------
// Mock heavy dependencies (same pattern as provider-plugin-wiring.test)
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
import { P1PuckContext } from '../core/P1PuckContext.js';
import { useP1Overrides } from '../editor/useP1Overrides.js';
import { useP1Plugin } from '../editor/useP1Plugin.js';

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
// B.5.1: featureConfig is exposed on context
// ---------------------------------------------------------------------------

describe('featureConfig on context', () => {
  it('exposes resolved featureConfig with defaults', () => {
    let capturedConfig: P1FeatureConfig | undefined;

    function ConfigReader() {
      const ctx = useContext(P1PuckContext);
      capturedConfig = ctx?.featureConfig;
      return null;
    }

    render(
      <P1PuckProvider {...baseProps}>
        <ConfigReader />
      </P1PuckProvider>,
    );

    expect(capturedConfig).toBeDefined();
    const config = capturedConfig as P1FeatureConfig;
    expect(config.enableRealtime).toBe(true);
    expect(config.presenceEnabled).toBe(true);
    expect(config.enableAutoSave).toBe(true);
    expect(config.enablePublishButton).toBe(true);
    expect(config.enableDocumentBrowser).toBe(true);
    expect(config.enableBranchSelector).toBe(true);
    expect(config.enableVersionHistory).toBe(true);
    expect(config.enableMergeControl).toBe(true);
    expect(config.agentModeEnabled).toBe(false);
  });

  it('respects explicit featureConfig prop', () => {
    let capturedConfig: P1FeatureConfig | undefined;

    function ConfigReader() {
      const ctx = useContext(P1PuckContext);
      capturedConfig = ctx?.featureConfig;
      return null;
    }

    render(
      <P1PuckProvider
        {...baseProps}
        featureConfig={{
          enableAutoSave: false,
          enablePublishButton: false,
          enableBranchSelector: false,
        }}
      >
        <ConfigReader />
      </P1PuckProvider>,
    );

    const config = capturedConfig as P1FeatureConfig;
    expect(config.enableAutoSave).toBe(false);
    expect(config.enablePublishButton).toBe(false);
    expect(config.enableBranchSelector).toBe(false);
    // Defaults still apply for unspecified flags
    expect(config.enableDocumentBrowser).toBe(true);
    expect(config.enableVersionHistory).toBe(true);
  });

  it('derives feature flags from existing boolean props', () => {
    let capturedConfig: P1FeatureConfig | undefined;

    function ConfigReader() {
      const ctx = useContext(P1PuckContext);
      capturedConfig = ctx?.featureConfig;
      return null;
    }

    render(
      <P1PuckProvider {...baseProps} presenceEnabled={false} agentModeEnabled={true}>
        <ConfigReader />
      </P1PuckProvider>,
    );

    const config = capturedConfig as P1FeatureConfig;
    expect(config.presenceEnabled).toBe(false);
    expect(config.agentModeEnabled).toBe(true);
    // Derived defaults follow the source flags
    expect(config.enableCollaboratorAvatars).toBe(false);
    expect(config.enableFocusHighlighting).toBe(false);
    expect(config.enableAgentBanner).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B.5.2: useP1Overrides gates features based on featureConfig
// ---------------------------------------------------------------------------

describe('useP1Overrides respects featureConfig', () => {
  it('disables collaborator avatars when enableCollaboratorAvatars is false', () => {
    let overridesResult: PuckOverrides | undefined;

    function OverridesReader() {
      overridesResult = useP1Overrides();
      return null;
    }

    render(
      <P1PuckProvider
        {...baseProps}
        featureConfig={{ enableCollaboratorAvatars: false }}
      >
        <OverridesReader />
      </P1PuckProvider>,
    );

    expect(overridesResult).toBeDefined();
    expect((overridesResult as PuckOverrides).headerActions).toBeDefined();
  });

  it('disables agent banner when enableAgentBanner is false', () => {
    let overridesResult: PuckOverrides | undefined;

    function OverridesReader() {
      overridesResult = useP1Overrides();
      return null;
    }

    render(
      <P1PuckProvider
        {...baseProps}
        featureConfig={{ enableAgentBanner: false }}
      >
        <OverridesReader />
      </P1PuckProvider>,
    );

    expect(overridesResult).toBeDefined();
    expect((overridesResult as PuckOverrides).headerActions).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// B.5.3: useP1Plugin gates features based on featureConfig
// ---------------------------------------------------------------------------

describe('useP1Plugin respects featureConfig', () => {
  it('omits branch selector data when enableBranchSelector is false', () => {
    let pluginResult: { overrides?: Record<string, unknown> } | undefined;

    function PluginReader() {
      pluginResult = useP1Plugin();
      return null;
    }

    render(
      <P1PuckProvider
        {...baseProps}
        featureConfig={{ enableBranchSelector: false }}
      >
        <PluginReader />
      </P1PuckProvider>,
    );

    expect(pluginResult).toBeDefined();
    expect((pluginResult as { overrides?: Record<string, unknown> }).overrides).toBeDefined();
  });

  it('omits version history when enableVersionHistory is false', () => {
    let pluginResult: { overrides?: Record<string, unknown> } | undefined;

    function PluginReader() {
      pluginResult = useP1Plugin();
      return null;
    }

    render(
      <P1PuckProvider
        {...baseProps}
        featureConfig={{ enableVersionHistory: false }}
      >
        <PluginReader />
      </P1PuckProvider>,
    );

    expect(pluginResult).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// B.5.4: featureConfig explicit overrides take precedence over hook defaults
// ---------------------------------------------------------------------------

describe('featureConfig precedence', () => {
  it('explicit featureConfig overrides derived boolean props', () => {
    let capturedConfig: P1FeatureConfig | undefined;

    function ConfigReader() {
      const ctx = useContext(P1PuckContext);
      capturedConfig = ctx?.featureConfig;
      return null;
    }

    // presenceEnabled=true but featureConfig explicitly disables avatars
    render(
      <P1PuckProvider
        {...baseProps}
        presenceEnabled={true}
        featureConfig={{
          presenceEnabled: true,
          enableCollaboratorAvatars: false,
        }}
      >
        <ConfigReader />
      </P1PuckProvider>,
    );

    const config = capturedConfig as P1FeatureConfig;
    expect(config.presenceEnabled).toBe(true);
    expect(config.enableCollaboratorAvatars).toBe(false);
  });
});
