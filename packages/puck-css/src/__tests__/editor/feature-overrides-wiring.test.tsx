/**
 * A feature plugin's `puckOverrides` reach the editor as their own entry in the
 * Puck plugin array. The overrides useP1Overrides builds carry none of them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';

import type { P1FeaturePlugin } from '../../core/plugin-types.js';
import type { PuckOverrides } from '../../editor/plugin/createP1Overrides.js';

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
    refresh: vi.fn(),
  }),
}));

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

const mockClient = {
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
mockClient.withPrincipal.mockReturnValue(mockClient);

import { P1PuckProvider } from '../../editor/P1PuckProvider.js';
import { useP1Puck } from '../../core/P1PuckContext.js';
import { useP1Overrides } from '../../editor/useP1Overrides.js';
import type { PuckContribution } from '../../core/plugin-types.js';

const decoratorPlugin: P1FeaturePlugin = {
  name: 'decorator',
  puckOverrides: () => ({
    fieldTypes: {
      text: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="feature-chrome">{children}</div>
      ),
    },
    componentItem: () => <div data-testid="feature-component-item" />,
    headerActions: () => <div data-testid="feature-header-actions" />,
  }),
};

function readEditor(plugins: P1FeaturePlugin[]): {
  contributions: readonly PuckContribution[];
  overrides: PuckOverrides;
} {
  let captured:
    | { contributions: readonly PuckContribution[]; overrides: PuckOverrides }
    | undefined;
  function Reader() {
    captured = {
      contributions: useP1Puck().featurePuckPlugins,
      overrides: useP1Overrides(),
    };
    return null;
  }
  render(
    <P1PuckProvider
      client={mockClient as unknown as Parameters<typeof P1PuckProvider>[0]['client']}
      siteId="site-1"
      branchId="branch-1"
      userId="user-1"
      featurePlugins={plugins}
    >
      <Reader />
    </P1PuckProvider>,
  );
  if (!captured) throw new Error('the provider rendered nothing');
  return captured;
}

/**
 * Renders the provider and switches branch through context. `branchId` is a
 * provider prop only as a seed: the provider owns the live branch, and its
 * resolution pass validates that branch against the site's list, so the switch
 * only sticks for a branch the list contains.
 */
async function switchBranchOn(plugins: P1FeaturePlugin[]): Promise<{
  seen: (readonly PuckContribution[])[];
  branchIds: string[];
}> {
  mockClient.branches.list.mockResolvedValue([
    { id: 'branch-1', isMain: true, name: 'Live' },
    { id: 'branch-2', isMain: false, name: 'Draft' },
  ]);

  const seen: (readonly PuckContribution[])[] = [];
  const branchIds: string[] = [];
  let latestSwitch: ((branchId: string) => Promise<void>) | undefined;
  function Reader() {
    const ccr = useP1Puck();
    seen.push(ccr.featurePuckPlugins);
    branchIds.push(ccr.branchId);
    latestSwitch = ccr.switchBranch;
    return null;
  }

  render(
    <P1PuckProvider
      client={mockClient as unknown as Parameters<typeof P1PuckProvider>[0]['client']}
      siteId="site-1"
      branchId="branch-1"
      userId="user-1"
      featurePlugins={plugins}
    >
      <Reader />
    </P1PuckProvider>,
  );

  // Let branch resolution settle first; it also calls setBranchId.
  await act(async () => {
    await Promise.resolve();
  });
  if (!latestSwitch) throw new Error('the provider rendered nothing');
  const doSwitch = latestSwitch;
  await act(async () => {
    await doSwitch('branch-2');
  });

  return { seen, branchIds };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('feature plugin overrides through the provider', () => {
  it('hands a plugin\'s overrides to Puck as their own plugin entry', () => {
    const { contributions } = readEditor([decoratorPlugin]);

    expect(contributions).toHaveLength(1);
    const entry = contributions[0] as { overrides: Record<string, unknown> };
    expect(Object.keys(entry.overrides).sort()).toEqual([
      'componentItem',
      'fieldTypes',
      'headerActions',
    ]);
  });

  it('orders entries by plugin priority', () => {
    const first: P1FeaturePlugin = {
      name: 'first',
      priority: 10,
      puckOverrides: () => ({ header: () => <div data-testid="first" /> }),
    };
    const second: P1FeaturePlugin = {
      name: 'second',
      priority: 20,
      puckOverrides: () => ({ header: () => <div data-testid="second" /> }),
    };

    const { contributions } = readEditor([second, first]);

    const rendered = contributions.map((c) => {
      const Header = (c as { overrides: Record<string, React.ComponentType> }).overrides
        .header!;
      const { container } = render(<Header />);
      return container.querySelector('[data-testid]')?.getAttribute('data-testid');
    });
    expect(rendered).toEqual(['first', 'second']);
  });

  it('contributes nothing when a plugin declares no overrides', () => {
    const { contributions } = readEditor([{ name: 'inert' }]);
    expect(contributions).toEqual([]);
  });

  it('hands Puck the same contributions array across a branch switch', async () => {
    const { seen, branchIds } = await switchBranchOn([decoratorPlugin]);

    expect(branchIds.at(-1)).toBe('branch-2');
    expect(new Set(seen).size).toBe(1);
  });

  it('renders a contribution against the branch the editor is on now', async () => {
    const branchReporter: P1FeaturePlugin = {
      name: 'branch-reporter',
      puckOverrides: (deps) => ({
        header: () => <div data-testid="branch">{deps.branchId}</div>,
      }),
    };
    const { seen, branchIds } = await switchBranchOn([branchReporter]);

    expect(branchIds.at(-1)).toBe('branch-2');
    const latest = seen[seen.length - 1]!;
    const Header = (latest[0] as { overrides: Record<string, React.ComponentType> })
      .overrides.header!;
    render(<Header />);
    expect(screen.getByTestId('branch').textContent).toBe('branch-2');
  });

  it('leaves the base overrides untouched by what a feature contributes', () => {
    const { overrides } = readEditor([decoratorPlugin]);

    render(React.createElement(overrides.headerActions as React.ComponentType));
    expect(screen.queryByTestId('feature-header-actions')).toBeNull();

    const Text = (overrides.fieldTypes as Record<string, React.ComponentType<Record<string, unknown>>>)
      .text!;
    render(
      <Text name="title" field={{ type: 'text', metadata: { help: 'Shown under the input' } }}>
        <input data-testid="the-field" />
      </Text>,
    );
    expect(screen.getByTestId('the-field')).toBeTruthy();
    expect(screen.getByText('Shown under the input')).toBeTruthy();
    expect(screen.queryByTestId('feature-chrome')).toBeNull();
  });
});
