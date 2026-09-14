/**
 * Localization Overrides Wiring Tests
 *
 * The localization feature plugin contributes per-prop fields-panel overrides
 * via the fieldTypes override, which resolves the prop each field addresses and
 * offers it to the label row. These reach Puck as their own entry in the plugin
 * array, contributed by the always-active localization plugin; the glyph the
 * label row draws self-gates on the open document.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

import type { P1FeaturePluginDeps, PuckContribution } from '../../core/plugin-types.js';
import type { P1PuckContextValue } from '../../core/types.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { resolveFeatureConfig } from '../../core/featureConfig.js';
import { resolveActivePlugins, collectPuckPlugins } from '../../editor/composePlugins.js';
import { DEFAULT_CCR_FEATURE_PLUGINS } from '../../editor/defaultPlugins.js';
import { localizationPlugin } from '../../features/localization/index.js';
import { buildLocalizationOverrides } from '../../features/localization/puck-overrides.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';

const makeDeps = (overrides?: Partial<P1FeaturePluginDeps>): P1FeaturePluginDeps => ({
  client: {} as P1FeaturePluginDeps['client'],
  siteId: 'site-1',
  branchId: 'branch-1',
  userId: 'user-1',
  config: resolveFeatureConfig({}),
  ...overrides,
});

describe('buildLocalizationOverrides', () => {
  it('provides fieldTypes (text, textarea) and no fieldLabel override', () => {
    const overrides = buildLocalizationOverrides(makeDeps());
    const fieldTypes = overrides.fieldTypes as Record<string, unknown>;
    expect(typeof fieldTypes.text).toBe('function');
    expect(typeof fieldTypes.textarea).toBe('function');
    expect(overrides.fieldLabel).toBeUndefined();
  });
});

describe('localizationPlugin.puckOverrides', () => {
  it('registers the fieldTypes fields-panel overrides only', () => {
    const { puckOverrides } = localizationPlugin;
    expect(typeof puckOverrides).toBe('function');
    if (!puckOverrides) throw new Error('puckOverrides should be defined');
    const overrides = puckOverrides(makeDeps());
    expect(overrides).toHaveProperty('fieldTypes');
    expect(overrides).not.toHaveProperty('fieldLabel');
  });
});

/**
 * The localization contribution among the default plugins' Puck entries.
 */
function localizationContribution(): { overrides: Record<string, unknown> } {
  const config = resolveFeatureConfig({});
  const active = resolveActivePlugins(DEFAULT_CCR_FEATURE_PLUGINS, config);
  const entries = collectPuckPlugins(active, makeDeps({ config }));
  const withOverrides = entries.filter(
    (e): e is { overrides: Record<string, unknown> } => 'overrides' in e,
  );
  const entry = withOverrides[0];
  if (!entry) throw new Error('no plugin entry carries overrides');
  return entry;
}

describe('the default plugins carry the localization overrides', () => {
  it('contributes them as a plugin entry holding fieldTypes', () => {
    const { overrides } = localizationContribution();
    expect(overrides).toHaveProperty('fieldTypes');
    expect(overrides).not.toHaveProperty('fieldLabel');
  });
});

// ---------------------------------------------------------------------------
// Consumer path: the provider hands the contribution to the editor
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

vi.mock('../../editor/useRealtime', () => ({
  useRealtime: () => ({ ...mockRealtimeState }),
}));

vi.mock('../../editor/useDocuments', () => ({
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
  sites: {
    get: vi.fn().mockResolvedValue({ name: 'Test Site' }),
    getSettings: vi.fn().mockResolvedValue({ settings: { locales: { markets: ['fr-FR'] } } }),
  },
  translations: {
    getAuthorityOverrides: vi.fn().mockResolvedValue({ authorityOverrides: {} }),
    setAuthorityOverride: vi.fn(),
    clearAuthorityOverride: vi.fn(),
  },
  withPrincipal: vi.fn(),
};
mockClientMethods.withPrincipal.mockReturnValue(mockClientMethods);

vi.mock('../../core/NotificationContext', () => ({
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

import { P1PuckProvider } from '../../editor/P1PuckProvider.js';
import { useP1Puck } from '../../core/P1PuckContext.js';
import { useP1Overrides } from '../../editor/useP1Overrides.js';
import type { PuckOverrides } from '../../editor/plugin/createP1Overrides.js';

const baseProps = {
  client: mockClientMethods as unknown as Parameters<typeof P1PuckProvider>[0]['client'],
  siteId: 'site-1',
  branchId: 'branch-1',
  userId: 'user-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('provider localization wiring', () => {
  it('carries the fieldTypes overrides in the Puck plugin entries', () => {
    let captured: PuckContribution[] | undefined;
    function Reader() {
      captured = useP1Puck().featurePuckPlugins;
      return null;
    }
    render(
      <P1PuckProvider {...baseProps}>
        <Reader />
      </P1PuckProvider>,
    );
    const overrides = (captured ?? [])
      .filter((e): e is { overrides: Record<string, unknown> } => 'overrides' in e)
      .map((e) => e.overrides);
    expect(overrides.some((o) => o.fieldTypes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The base overrides register help text on text and textarea. Puck nests a
// plugin's overrides around the editor's own, so both have to survive.
// ---------------------------------------------------------------------------

const translationDoc = {
  id: 'doc-fr',
  siteId: 'site-1',
  path: 'pages/home.fr-FR',
  archived: false,
  locale: 'fr-FR',
  localizedFromId: 'doc-canonical',
};

function translationContext(): P1PuckContextValue {
  const config = resolveFeatureConfig({});
  return {
    client: mockClientMethods,
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument: translationDoc,
    documents: [translationDoc],
    featureConfig: config,
    featurePuckPlugins: collectPuckPlugins(
      resolveActivePlugins(DEFAULT_CCR_FEATURE_PLUGINS, config),
      makeDeps({ config }),
    ),
  } as unknown as P1PuckContextValue;
}

describe('the localization field renderer', () => {
  it('marks the label row while the base help text and the field survive', async () => {
    let baseOverrides: PuckOverrides | undefined;
    function Reader() {
      baseOverrides = useP1Overrides();
      return null;
    }

    const ctx = translationContext();
    render(
      <P1PuckContext.Provider value={ctx}>
        <Reader />
      </P1PuckContext.Provider>,
    );

    const fieldProps = {
      name: 'title',
      id: 'comp-1_text_title',
      field: { type: 'text', metadata: { help: 'Shown under the input' } },
      value: 'Bonjour',
      onChange: vi.fn(),
    };
    const BaseText = (
      (baseOverrides as PuckOverrides).fieldTypes as Record<
        string,
        React.ComponentType<Record<string, unknown>>
      >
    ).text;
    const LocalizedText = (
      localizationContribution().overrides.fieldTypes as Record<
        string,
        React.ComponentType<Record<string, unknown>>
      >
    ).text;
    expect(LocalizedText).toBeDefined();

    const Label = (baseOverrides as PuckOverrides).fieldLabel as React.ComponentType<
      Record<string, unknown>
    >;

    render(
      <P1SdkQueryClientContext.Provider
        value={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <P1PuckContext.Provider value={ctx}>
          <LocalizedText {...fieldProps}>
            <BaseText {...fieldProps}>
              <Label label="Title">
                <input data-testid="the-field" defaultValue="Bonjour" />
              </Label>
            </BaseText>
          </LocalizedText>
        </P1PuckContext.Provider>
      </P1SdkQueryClientContext.Provider>,
    );

    expect(screen.getByTestId('the-field')).toBeTruthy();
    expect(screen.getByText('Shown under the input')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('loc-translation-glyph')).toBeTruthy());
  });
});
