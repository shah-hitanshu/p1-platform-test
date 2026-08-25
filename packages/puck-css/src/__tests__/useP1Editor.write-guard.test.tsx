/**
 * Tests for the cross-document write-back guard.
 *
 * With a single Puck instance surviving document switches, onChange can fire
 * while the canvas still shows the previous document but the CCR client
 * already points at the new one (loadDocument mid-flight, or loaded but not
 * yet pushed into Puck). Saving in that window would write the old page's
 * content into the new page. The guard drops saves whenever the document the
 * canvas shows (the sync store's applied key) differs from the document a
 * save would target.
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
  createUsePuck: () => (selector: (s: unknown) => unknown) =>
    selector(fakePuckState),
  useGetPuck: () => () => fakePuckState,
}));

const mockLoadDocument = vi.fn<(...args: unknown[]) => Promise<void>>();
const mockSaveData = vi.fn();

const mockCcrContext = {
  branchId: "branch-a",
  loadDocument: mockLoadDocument,
  documents: [] as {
    id: string;
    path: string;
    siteId: string;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
  }[],
  documentsLoading: false,
  currentDocument: null as null | { id: string; path: string; siteId: string },
  currentData: null,
  currentDataOrigin: null as null | Record<string, unknown>,
  safeData: { content: [], root: { props: {} }, zones: {} },
  siteId: "site-test",
  siteName: null,
  client: {} as unknown,
  sendFocusRegions: vi.fn().mockReturnValue(false),
  isViewingHistoricalVersion: false,
  saveData: mockSaveData,
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

vi.mock("../core/P1PuckContext", () => ({
  useP1Puck: () => mockCcrContext,
}));

vi.mock("../editor/useP1Plugin", () => ({
  useP1Plugin: () => ({ name: "p1" }),
}));

vi.mock("../editor/useP1Overrides", () => ({
  useP1Overrides: () => ({}),
}));

vi.mock("../versioning/useVersions", () => ({
  useVersions: () => ({
    versions: [],
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../editor/useComponentRegistry", () => ({
  useComponentRegistry: () => undefined,
}));

vi.mock("../editor/utils/buildThumbnailOverride", () => ({
  buildThumbnailOverride: () => ({}),
}));

vi.mock("../auth/index", () => ({
  useP1Auth: () => ({ user: null, logout: vi.fn() }),
}));

import type { Plugin } from "@puckeditor/core";
import { useP1Editor } from "../editor/useP1Editor";

function makeDoc(id: string, path: string) {
  return { id, path, siteId: "site-test" };
}

/**
 * A settled load: the document and the identity its data was loaded under land
 * together, exactly as the provider commits them. Only a payload carrying an
 * origin is publishable, so the canvas cannot be told it holds a document whose
 * data never arrived.
 */
function commitLoaded(id: string, path: string) {
  mockCcrContext.currentDocument = makeDoc(id, path);
  mockCcrContext.currentDataOrigin = {
    branchId: mockCcrContext.branchId,
    documentId: id,
    documentPath: path,
    versionId: `v-${id}`,
    historical: false,
  };
}

const editData = {
  root: { props: { title: "edited" } },
  content: [],
  zones: {},
};

/** Mounts the document-sync plugin's puck override so DocumentSync runs. */
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
  mockCcrContext.branchId = "branch-a";
  mockCcrContext.currentDocument = null;
  mockCcrContext.currentDataOrigin = null;
  mockCcrContext.isViewingHistoricalVersion = false;
});

describe("useP1Editor write-back guard", () => {
  it("saves normally when no document has been applied yet (initial mount)", async () => {
    mockLoadDocument.mockImplementation(async () => {
      commitLoaded("doc-a", "/a");
    });

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: "/a", puckConfig: {} }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.puckProps.onChange(editData);
    });

    expect(mockSaveData).toHaveBeenCalledWith(editData);
  });

  it("saves when the applied document matches the current document", async () => {
    mockLoadDocument.mockImplementation(async () => {
      commitLoaded("doc-a", "/a");
    });

    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: "/a", puckConfig: {} }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    mountSyncPlugin(result.current.puckProps.plugins as Plugin[]);

    act(() => {
      result.current.puckProps.onChange(editData);
    });

    expect(mockSaveData).toHaveBeenCalledWith(editData);
  });

  it("drops saves while a switch is in flight and the target document changed", async () => {
    mockLoadDocument.mockImplementationOnce(async () => {
      commitLoaded("doc-a", "/a");
    });

    const { result, rerender } = renderHook(
      ({ path }: { path: string }) =>
        useP1Editor({ documentPath: path, puckConfig: {} }),
      { initialProps: { path: "/a" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ path: "/a" });
    mountSyncPlugin(result.current.puckProps.plugins as Plugin[]);

    // Switch begins: ccr already targets doc-b and the provider has cleared the
    // data origin, so no payload is publishable while the fetch is in flight.
    let resolveLoad: () => void = () => undefined;
    mockLoadDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          mockCcrContext.currentDocument = makeDoc("doc-b", "/b");
          mockCcrContext.currentDataOrigin = null;
          resolveLoad = resolve;
        }),
    );
    rerender({ path: "/b" });
    await waitFor(() => expect(result.current.reloading).toBe("document"));

    act(() => {
      result.current.puckProps.onChange(editData);
    });
    expect(mockSaveData).not.toHaveBeenCalled();

    // doc-b's data lands, so the sync plugin can push it into the canvas
    act(() => {
      commitLoaded("doc-b", "/b");
      resolveLoad();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ path: "/b" });

    act(() => {
      result.current.puckProps.onChange(editData);
    });
    expect(mockSaveData).toHaveBeenCalledWith(editData);
  });

  it("keeps allowing saves to the old document until ccr switches away from it", async () => {
    mockLoadDocument.mockImplementationOnce(async () => {
      commitLoaded("doc-a", "/a");
    });

    const { result, rerender } = renderHook(
      ({ path }: { path: string }) =>
        useP1Editor({ documentPath: path, puckConfig: {} }),
      { initialProps: { path: "/a" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ path: "/a" });
    mountSyncPlugin(result.current.puckProps.plugins as Plugin[]);

    // Switch begins but currentDocument has not flipped yet: a late edit on
    // the old canvas still targets the old document — must save.
    mockLoadDocument.mockImplementationOnce(() => new Promise<void>(() => undefined));
    rerender({ path: "/b" });

    act(() => {
      result.current.puckProps.onChange(editData);
    });
    expect(mockSaveData).toHaveBeenCalledWith(editData);
  });

  it("blocks a save when only the branch differs, until the new branch's copy lands", async () => {
    mockLoadDocument.mockImplementationOnce(async () => {
      commitLoaded("doc-a", "/a");
    });

    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: "/a", puckConfig: {} }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    mountSyncPlugin(result.current.puckProps.plugins as Plugin[]);

    // Same page, different workstream: the canvas still holds branch-a's copy
    // while ccr targets branch-b's. Saving would cross-write between branches.
    let resolveLoad: () => void = () => undefined;
    mockLoadDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    act(() => {
      mockCcrContext.branchId = "branch-b";
      mockCcrContext.currentDataOrigin = null;
    });
    rerender();
    await waitFor(() => expect(result.current.reloading).toBe("branch"));

    act(() => {
      result.current.puckProps.onChange(editData);
    });
    expect(mockSaveData).not.toHaveBeenCalled();

    // branch-b's copy of the same document lands: the canvas catches up and
    // saves target the workstream on screen again.
    act(() => {
      commitLoaded("doc-a", "/a");
      resolveLoad();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();

    act(() => {
      result.current.puckProps.onChange(editData);
    });
    expect(mockSaveData).toHaveBeenCalledWith(editData);
  });

  it("still blocks saves for historical versions", async () => {
    mockLoadDocument.mockImplementation(async () => {
      commitLoaded("doc-a", "/a");
    });

    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: "/a", puckConfig: {} }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockCcrContext.isViewingHistoricalVersion = true;
    rerender();

    act(() => {
      result.current.puckProps.onChange(editData);
    });
    expect(mockSaveData).not.toHaveBeenCalled();
  });
});
