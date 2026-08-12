import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import React from "react";
import type { PuckData } from "@pantheon-systems/css-client";

const mockSetHistories = vi.fn();

interface FakeAppState {
  data: PuckData;
  ui: Record<string, unknown>;
  indexes: Record<string, unknown>;
}

let fakePuckState: {
  appState: FakeAppState;
  history: { setHistories: typeof mockSetHistories };
};

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => (selector: (s: unknown) => unknown) =>
    selector(fakePuckState),
  useGetPuck: () => () => fakePuckState,
}));

const { createDocumentSyncStore, createDocumentSyncPlugin, BLANK_SYNC_KEY } = await import(
  "../../editor/plugin/document-sync-plugin.js"
);

const docA: PuckData = {
  root: { props: { title: "Page A" } },
  content: [],
  zones: {},
};

const docB: PuckData = {
  root: { props: { title: "Page B" } },
  content: [{ type: "Heading", props: { id: "h1", text: "B" } }],
  zones: {},
};

function makeAppState(data: PuckData): FakeAppState {
  return {
    data,
    ui: {
      itemSelector: { index: 0, zone: "root" },
      leftSideBarVisible: true,
      rightSideBarVisible: false,
    },
    indexes: { nodes: { stale: true }, zones: { stale: true } },
  };
}

function renderPlugin(store: ReturnType<typeof createDocumentSyncStore>) {
  const plugin = createDocumentSyncPlugin(store);
  const puckOverride = plugin.overrides?.puck;
  if (!puckOverride) throw new Error("plugin has no puck override");
  const PuckOverride = puckOverride as React.FC<{
    children: React.ReactNode;
  }>;
  return render(
    <PuckOverride>
      <div data-testid="canvas">canvas</div>
    </PuckOverride>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakePuckState = {
    appState: makeAppState(docA),
    history: { setHistories: mockSetHistories },
  };
});

describe("createDocumentSyncStore", () => {
  it("starts with an empty snapshot", () => {
    const store = createDocumentSyncStore();
    expect(store.getSnapshot()).toEqual({ syncKey: null, data: null });
  });

  it("returns the published snapshot", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    expect(store.getSnapshot()).toEqual({ syncKey: "branch1:docA", data: docA });
  });

  it("notifies subscribers on publish and stops after unsubscribe", () => {
    const store = createDocumentSyncStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.publish({ syncKey: "branch1:docA", data: docA });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.publish({ syncKey: "branch1:docB", data: docB });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps snapshot identity stable between publishes", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});

describe("createDocumentSyncPlugin", () => {
  it("renders children through the puck override", () => {
    const store = createDocumentSyncStore();
    renderPlugin(store);
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("does not touch history on mount", () => {
    const store = createDocumentSyncStore();
    renderPlugin(store);
    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  // Puck mounts with blank data and the branch is restored from storage after
  // mount, so the first document observed was never already on the canvas — it
  // has to be pushed like any other. Skipping it left the editor one document
  // behind from the very first load.
  it("pushes the first published document onto the blank canvas", () => {
    const store = createDocumentSyncStore();
    renderPlugin(store);

    act(() => {
      store.publish({ syncKey: "branch1:docA", data: docA });
    });

    expect(mockSetHistories).toHaveBeenCalledTimes(1);
    expect(mockSetHistories.mock.calls[0][0][0].state.data).toBe(docA);
  });

  it("pushes a snapshot published before mount", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);
    expect(mockSetHistories).toHaveBeenCalledTimes(1);
    expect(mockSetHistories.mock.calls[0][0][0].state.data).toBe(docA);
  });

  it("resets history with the new document state when the sync key changes", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);
    mockSetHistories.mockClear();

    act(() => {
      store.publish({ syncKey: "branch1:docB", data: docB });
    });

    expect(mockSetHistories).toHaveBeenCalledTimes(1);
    const histories = mockSetHistories.mock.calls[0][0];
    expect(histories).toHaveLength(1);
    const { state } = histories[0];
    expect(state.data).toBe(docB);
    expect(state.ui.itemSelector).toBeNull();
    expect(state.ui.leftSideBarVisible).toBe(true);
    expect(state.ui.rightSideBarVisible).toBe(false);
    expect(state).not.toHaveProperty("indexes");
  });

  it("ignores republish of the same sync key with different data", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);
    mockSetHistories.mockClear();

    act(() => {
      store.publish({
        syncKey: "branch1:docA",
        data: { ...docA, root: { props: { title: "Page A (edited)" } } },
      });
    });

    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  it("ignores snapshots without data", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);
    mockSetHistories.mockClear();

    act(() => {
      store.publish({ syncKey: "branch1:docB", data: null });
    });

    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  it("marks the first document applied after pushing it", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);

    expect(store.getAppliedKey()).toBe("branch1:docA");
    expect(mockSetHistories).toHaveBeenCalledTimes(1);
  });

  it("reports the blank sentinel before any document is observed", () => {
    const store = createDocumentSyncStore();
    renderPlugin(store);
    expect(store.getAppliedKey()).toBe(BLANK_SYNC_KEY);
  });

  it("marks the new document as applied after pushing it", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);

    act(() => {
      store.publish({ syncKey: "branch1:docB", data: docB });
    });

    expect(store.getAppliedKey()).toBe("branch1:docB");
  });

  it("keeps the applied key across a remount (role change)", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    const { unmount } = renderPlugin(store);
    unmount();
    mockSetHistories.mockClear();
    renderPlugin(store);

    // The store outlives the remount, so the same document is not pushed twice.
    expect(store.getAppliedKey()).toBe("branch1:docA");
    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  it("dispatches again on each subsequent document switch", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);
    mockSetHistories.mockClear();

    act(() => {
      store.publish({ syncKey: "branch1:docB", data: docB });
    });
    act(() => {
      store.publish({ syncKey: "branch2:docB", data: docB });
    });

    expect(mockSetHistories).toHaveBeenCalledTimes(2);
  });

  // The same page on two branches: identical documentId, and blank snapshots
  // even share payload identity via snapshotToPuckData's shared empty constant.
  // Only the branch component of the key distinguishes them.
  it("pushes the same document across a branch switch", () => {
    const store = createDocumentSyncStore();
    const blank = { content: [], root: { props: {} } };
    store.publish({ syncKey: "branch1:docA", data: blank });
    renderPlugin(store);
    mockSetHistories.mockClear();

    act(() => {
      store.publish({ syncKey: "branch2:docA", data: blank });
    });

    expect(mockSetHistories).toHaveBeenCalledTimes(1);
    expect(store.getAppliedKey()).toBe("branch2:docA");
  });
});
