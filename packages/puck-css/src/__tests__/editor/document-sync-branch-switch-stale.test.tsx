/**
 * Regression test for the publisher half of "the editor renders one workstream
 * behind".
 *
 * The sync key used to be built from the live branchId while the data was read
 * from a ref. Those come from different clocks: a switch flips branchId
 * synchronously, so the effect re-ran and published the *incoming* branch's key
 * beside the *outgoing* branch's data. The plugin applied that pairing and
 * recorded the new key as applied, so the correct document — published moments
 * later under the same key — was skipped as already applied. The canvas stayed a
 * workstream behind and never recovered.
 *
 * Both key and data now come from the payload's own origin, which makes that
 * pairing unrepresentable rather than merely guarded against.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, render, act, waitFor } from "@testing-library/react";
import React from "react";

const mockSetHistories = vi.fn();
const fakePuckState = {
  appState: {
    data: { root: { props: {} }, content: [], zones: {} },
    ui: { itemSelector: null },
    indexes: {},
  },
  history: { setHistories: mockSetHistories },
};

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => (selector: (s: unknown) => unknown) => selector(fakePuckState),
  useGetPuck: () => () => fakePuckState,
}));

const mockLoadDocument = vi.fn<(...args: unknown[]) => Promise<void>>();

const oldBranchPage = {
  content: [{ type: "Card", props: { title: "CBB Partners with Teamworks" } }],
  root: { props: {} },
};
const newBranchPage = {
  content: [{ type: "Card", props: { title: "How the NCAA Found Clarity" } }],
  root: { props: {} },
};

const mockCssContext = {
  branchId: "branch-old",
  loadDocument: mockLoadDocument,
  documents: [] as unknown[],
  documentsLoading: false,
  currentDocument: null as null | { id: string; path: string; siteId: string },
  currentData: null as unknown,
  currentDataOrigin: null as null | Record<string, unknown>,
  safeData: oldBranchPage as unknown,
  siteId: "site-test",
  siteName: null,
  client: {} as unknown,
  sendFocusRegions: vi.fn().mockReturnValue(false),
  isViewingHistoricalVersion: false,
  saveData: vi.fn(),
  publishDocument: vi.fn().mockResolvedValue({}),
  switchBranch: vi.fn(),
  createBranch: vi.fn(),
  returnToLatest: vi.fn(),
  loadVersion: vi.fn(),
  viewingVersion: null,
  userId: "user-1",
  saveStatus: "idle" as const,
  lastSaved: null,
  saveError: null,
  saveNow: vi.fn(),
  createCheckpoint: vi.fn(),
  getSaveStatus: vi.fn(),
  getLastSaved: vi.fn(),
  getSaveError: vi.fn(),
  getHasUnsavedChanges: vi.fn(),
  getSyncData: vi.fn(),
  getDataSyncKey: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  branches: [],
  currentBranch: null,
  refreshBranches: vi.fn(),
  branchesLoading: false,
  autoSavePaused: false,
  pauseAutoSave: vi.fn(),
  resumeAutoSave: vi.fn(),
  latestVersionData: null,
  realtimeEnabled: false,
  realtimeConnected: false,
  remoteSyncKey: null,
  handleAction: vi.fn(),
  hasActiveHumans: false,
  humanPresenceCount: 0,
  hasActiveAgents: false,
  agentEdit: null,
  triggerAgent: vi.fn(),
  stopAgent: vi.fn(),
  conflicts: [],
  dismissConflict: vi.fn(),
  notifications: {
    addNotification: vi.fn(),
    notifications: [],
    dismissNotification: vi.fn(),
  },
  get presence() {
    return {
      actors: [],
      humans: [],
      agents: [],
      hasActiveHumans: false,
      hasActiveAgents: false,
    };
  },
  _realtimeDataCaptureRef: null,
  _onRealtimeDataCapture: null,
};

vi.mock("../../core/P1PuckContext", () => ({
  useP1Puck: () => mockCssContext,
}));

vi.mock("../../editor/useP1Plugin", () => ({
  useP1Plugin: () => ({ name: "p1" }),
}));

vi.mock("../../editor/useP1Overrides", () => ({
  useP1Overrides: () => ({}),
}));

vi.mock("../../versioning/useVersions", () => ({
  useVersions: () => ({
    versions: [],
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../editor/useComponentRegistry", () => ({
  useComponentRegistry: () => undefined,
}));

vi.mock("../../editor/utils/buildThumbnailOverride", () => ({
  buildThumbnailOverride: () => ({}),
}));

vi.mock("../../auth/index", () => ({
  useP1Auth: () => ({ user: null, logout: vi.fn() }),
}));

import type { Plugin } from "@puckeditor/core";
import { useP1Editor } from "../../editor/useP1Editor";

const blogDoc = { id: "doc-blog", path: "/blog", siteId: "site-test" };

const pageByBranch: Record<string, unknown> = {
  "branch-old": oldBranchPage,
  "branch-new": newBranchPage,
};

/** A settled load: the payload and the identity it was loaded under, together. */
function commitLoaded(branchId: string, data: unknown) {
  mockCssContext.currentDocument = blogDoc;
  mockCssContext.currentData = data;
  mockCssContext.safeData = data;
  mockCssContext.currentDataOrigin = {
    branchId,
    documentId: blogDoc.id,
    documentPath: blogDoc.path,
    versionId: `v-${branchId}`,
    historical: false,
  };
}

function mountSyncPlugin(plugins: Plugin[]) {
  const syncPlugin = plugins.find((p) => p.name === "p1-document-sync");
  if (!syncPlugin?.overrides?.puck) {
    throw new Error("document-sync plugin not found in puckProps.plugins");
  }
  const PuckOverride = syncPlugin.overrides.puck as React.FC<{
    children: React.ReactNode;
  }>;
  return render(<PuckOverride>{null}</PuckOverride>);
}

beforeEach(() => {
  vi.clearAllMocks();
  // A load always yields the page belonging to the branch it was requested for,
  // so a branch change reloads into that branch's document as it does in the app.
  mockLoadDocument.mockImplementation(async () => {
    commitLoaded(mockCssContext.branchId, pageByBranch[mockCssContext.branchId]);
  });
  mockCssContext.branchId = "branch-old";
  mockCssContext.currentDocument = null;
  mockCssContext.currentData = null;
  mockCssContext.currentDataOrigin = null;
  mockCssContext.safeData = oldBranchPage;
  mockCssContext.isViewingHistoricalVersion = false;
});

describe("document sync across a workstream switch", () => {
  it("does not push the outgoing branch's data under the incoming branch's key", async () => {
    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: "/blog", puckConfig: {} }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    mountSyncPlugin(result.current.puckProps.plugins as Plugin[]);
    // Let the first document's push settle so later assertions measure only
    // what the switch itself caused.
    await waitFor(() => expect(mockSetHistories).toHaveBeenCalled());
    mockSetHistories.mockClear();

    // The switch commits the branch immediately. The document body is still in
    // flight, so the provider has cleared the origin while safeData continues to
    // hold the outgoing branch's page.
    mockCssContext.branchId = "branch-new";
    mockCssContext.currentDataOrigin = null;
    rerender();

    expect(mockSetHistories).not.toHaveBeenCalled();

    // The correct document lands.
    act(() => {
      commitLoaded("branch-new", newBranchPage);
    });
    rerender();

    await waitFor(() => expect(mockSetHistories).toHaveBeenCalledTimes(1));
    expect(mockSetHistories.mock.calls[0][0][0].state.data).toEqual(newBranchPage);
  });

  it("still pushes when only the branch differs, on the same document", async () => {
    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: "/blog", puckConfig: {} }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    mountSyncPlugin(result.current.puckProps.plugins as Plugin[]);
    // Let the first document's push settle so later assertions measure only
    // what the switch itself caused.
    await waitFor(() => expect(mockSetHistories).toHaveBeenCalled());
    mockSetHistories.mockClear();

    act(() => {
      mockCssContext.branchId = "branch-new";
    });
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();

    await waitFor(() => expect(mockSetHistories).toHaveBeenCalledTimes(1));
    expect(mockSetHistories.mock.calls[0][0][0].state.data).toEqual(newBranchPage);
  });

  it("does not push a historical version into the live canvas", async () => {
    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: "/blog", puckConfig: {} }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    mountSyncPlugin(result.current.puckProps.plugins as Plugin[]);
    // Let the first document's push settle so later assertions measure only
    // what the switch itself caused.
    await waitFor(() => expect(mockSetHistories).toHaveBeenCalled());
    mockSetHistories.mockClear();

    act(() => {
      commitLoaded("branch-old", newBranchPage);
      mockCssContext.currentDataOrigin!.historical = true;
    });
    rerender();

    expect(mockSetHistories).not.toHaveBeenCalled();
  });
});
