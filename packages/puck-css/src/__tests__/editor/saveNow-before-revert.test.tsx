/**
 * persistCurrentEdits: P1PuckProvider.persistCurrentEdits must create a REST
 * version from the current in-memory state before a destructive operation
 * (revert). In realtime mode it first confirms delivery via waitForDelivery(),
 * then creates a version from latestLocalDataRef. In non-realtime mode it
 * delegates to performSave() which creates a version from pendingDataRef.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useContext } from 'react';
import type { PuckData } from '@pantheon-systems/css-client';

// =============================================================================
// Realtime mock
// =============================================================================

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
    refreshDocuments: vi.fn().mockResolvedValue([]),
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    refresh: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));

// =============================================================================
// Client mock
// =============================================================================

const mockClientMethods = {
  sites: { get: vi.fn().mockResolvedValue({ name: 'Test Site' }) },
  documents: {
    getByPath: vi.fn(),
    publish: vi.fn(),
  },
  versions: {
    getLatest: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'v-new' }),
  },
  branches: {
    list: vi.fn().mockResolvedValue([{ id: 'branch-1', isMain: true }]),
  },
  checkpoints: { create: vi.fn() },
  presence: {
    getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }),
  },
  agentEdit: {
    canEdit: vi.fn(),
    startEdit: vi.fn(),
    completeEdit: vi.fn(),
    abortEdit: vi.fn(),
    stopAgent: vi.fn(),
  },
  templates: {
    get: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
  },
  withPrincipal: vi.fn(),
};
mockClientMethods.withPrincipal.mockReturnValue(mockClientMethods);

vi.mock('@pantheon-systems/css-client', () => ({
  P1Client: vi.fn().mockImplementation(function () { return { ...mockClientMethods }; }),
}));

vi.mock('../../core/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotifications: () => ({
    addNotification: vi.fn(),
    addError: vi.fn(),
    addInfo: vi.fn(),
    addSuccess: vi.fn(),
    notifications: [],
    dismissNotification: vi.fn(),
  }),
}));

vi.mock('../../features/content-type-templates/hooks/useTemplateList', () => ({
  useTemplateList: () => ({ templates: [], loading: false, error: null, refresh: vi.fn() }),
}));

// =============================================================================
// Component under test
// =============================================================================

import { P1PuckContext } from '../../core/P1PuckContext';
import { P1PuckProvider } from '../../editor/P1PuckProvider';

let capturedCtx: ReturnType<typeof useContext<typeof P1PuckContext>> = null;

function ContextCapture() {
  capturedCtx = useContext(P1PuckContext);
  return null;
}

const TEST_PATH = '/pages/home';
const TEST_DOC = { id: 'doc-1', path: TEST_PATH, siteId: 'test-site', branchId: 'branch-1' };

const CURRENT_DATA: PuckData = {
  content: [{ type: 'Heading', props: { id: 'h1', text: 'Current edit' } }],
  root: { props: {} },
  zones: {},
};

const USER_EDIT_DATA: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Current edit' } },
    { type: 'Paragraph', props: { id: 'p1', text: 'New paragraph' } },
  ],
  root: { props: {} },
  zones: {},
};

async function renderProvider(enableRealtime = false) {
  const { P1Client } = await import('@pantheon-systems/css-client');
  const client = new P1Client({ baseUrl: 'http://localhost:8787', apiKey: 'test' });
  render(
    <P1PuckProvider
      client={client}
      siteId="test-site"
      branchId="branch-1"
      userId="user-1"
      enableRealtime={enableRealtime}
      wsBaseUrl="ws://localhost:8787"
      autoSaveDelay={3000}
    >
      <ContextCapture />
    </P1PuckProvider>
  );
}

async function openDocument() {
  const ctx = capturedCtx as unknown as {
    loadDocument: (p: string) => Promise<void>;
    saveData: (d: PuckData) => void;
  };
  mockClientMethods.documents.getByPath.mockResolvedValueOnce(TEST_DOC);
  mockClientMethods.versions.getLatest.mockResolvedValue({
    id: 'v1',
    documentId: 'doc-1',
    branchId: 'branch-1',
    snapshot: CURRENT_DATA,
    createdAt: '2026-01-01T00:00:00Z',
  });
  await act(async () => { await ctx.loadDocument(TEST_PATH); });
  // Clear mock call history after document load so only test-triggered calls appear
  mockClientMethods.versions.create.mockClear();
  mockClientMethods.versions.getLatest.mockClear();
}

// =============================================================================
// Tests
// =============================================================================

describe('persistCurrentEdits: creates a durable version before a destructive op', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCtx = null;
    mockRealtimeState.connected = false;
    mockRealtimeState.connectedDocumentPath = null;
    mockRealtimeState.waitForDelivery = vi.fn().mockResolvedValue(undefined);
    mockRealtimeState.applyLocalChange = vi.fn();
    mockRealtimeState.getSnapshot = vi.fn().mockReturnValue(null);
    mockClientMethods.withPrincipal.mockReturnValue(mockClientMethods);
    mockClientMethods.versions.create.mockResolvedValue({ id: 'v-new' });
    mockClientMethods.branches.list.mockResolvedValue([{ id: 'branch-1', isMain: true }]);
  });

  it('non-realtime: creates a REST version from pending edits', async () => {
    await renderProvider(false);
    await openDocument();

    const ctx = capturedCtx as unknown as {
      saveData: (d: PuckData) => void;
      persistCurrentEdits: () => Promise<void>;
    };

    // Simulate user edit queued in the debounce buffer
    act(() => { ctx.saveData(USER_EDIT_DATA); });

    mockClientMethods.documents.getByPath.mockResolvedValue(TEST_DOC);
    mockClientMethods.versions.getLatest.mockResolvedValue({
      id: 'v-new', documentId: 'doc-1', branchId: 'branch-1',
      snapshot: USER_EDIT_DATA, createdAt: '2026-01-02T00:00:00Z',
    });

    await act(async () => { await ctx.persistCurrentEdits(); });

    expect(mockClientMethods.versions.create).toHaveBeenCalledTimes(1);
    const call = mockClientMethods.versions.create.mock.calls[0][1];
    expect(call).toMatchObject({ snapshot: USER_EDIT_DATA });
  });

  it('realtime: calls waitForDelivery and creates a REST version from latestLocalData', async () => {
    mockRealtimeState.connected = true;
    mockRealtimeState.connectedDocumentPath = TEST_PATH;

    await renderProvider(true);
    // Allow the 100ms counter reset from loadDocument to expire
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    await openDocument();

    const ctx = capturedCtx as unknown as {
      saveData: (d: PuckData) => void;
      persistCurrentEdits: () => Promise<void>;
    };

    // Simulate user edit — sets latestLocalDataRef so persistCurrentEdits can version it
    act(() => { ctx.saveData(USER_EDIT_DATA); });

    await act(async () => { await ctx.persistCurrentEdits(); });

    expect(mockRealtimeState.waitForDelivery).toHaveBeenCalledTimes(1);
    expect(mockClientMethods.versions.create).toHaveBeenCalledTimes(1);
    const call = mockClientMethods.versions.create.mock.calls[0][1];
    expect(call).toMatchObject({ snapshot: USER_EDIT_DATA });
  });

  it('realtime: rejects when waitForDelivery fails so callers can warn the user', async () => {
    mockRealtimeState.connected = true;
    mockRealtimeState.connectedDocumentPath = TEST_PATH;
    mockRealtimeState.waitForDelivery = vi.fn().mockRejectedValue(new Error('WS timeout'));

    await renderProvider(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    await openDocument();

    const ctx = capturedCtx as unknown as {
      persistCurrentEdits: () => Promise<void>;
    };

    await expect(
      act(async () => { await ctx.persistCurrentEdits(); })
    ).rejects.toThrow('WS timeout');
  });

  it('realtime: skips version create when no local data to persist', async () => {
    mockRealtimeState.connected = true;
    mockRealtimeState.connectedDocumentPath = TEST_PATH;

    await renderProvider(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    await openDocument();
    // No saveData call — latestLocalDataRef is null after openDocument clears it

    const ctx = capturedCtx as unknown as {
      persistCurrentEdits: () => Promise<void>;
    };

    await act(async () => { await ctx.persistCurrentEdits(); });

    expect(mockRealtimeState.waitForDelivery).toHaveBeenCalledTimes(1);
    expect(mockClientMethods.versions.create).not.toHaveBeenCalled();
  });

  it('realtime disconnected: falls through to REST path without calling waitForDelivery', async () => {
    // Realtime enabled but NOT connected — must fall through to performSave
    mockRealtimeState.connected = false;

    await renderProvider(true);
    await openDocument();

    const ctx = capturedCtx as unknown as {
      persistCurrentEdits: () => Promise<void>;
    };

    await act(async () => { await ctx.persistCurrentEdits(); });

    expect(mockRealtimeState.waitForDelivery).not.toHaveBeenCalled();
  });
});
