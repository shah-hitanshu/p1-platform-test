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

const { createDocumentSyncStore, createDocumentSyncPlugin } = await import(
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

  it("treats the first published document as baseline without dispatching", () => {
    const store = createDocumentSyncStore();
    renderPlugin(store);

    act(() => {
      store.publish({ syncKey: "branch1:docA", data: docA });
    });

    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  it("adopts a pre-published snapshot as baseline on mount (role-change remount)", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);
    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  it("resets history with the new document state when the sync key changes", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);

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

    act(() => {
      store.publish({ syncKey: "branch1:docB", data: null });
    });

    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  it("marks the baseline document as applied without dispatching", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);

    expect(store.getAppliedKey()).toBe("branch1:docA");
    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  it("has no applied key before any document is observed", () => {
    const store = createDocumentSyncStore();
    renderPlugin(store);
    expect(store.getAppliedKey()).toBeNull();
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
    renderPlugin(store);

    expect(store.getAppliedKey()).toBe("branch1:docA");
    expect(mockSetHistories).not.toHaveBeenCalled();
  });

  it("dispatches again on each subsequent document switch", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);

    act(() => {
      store.publish({ syncKey: "branch1:docB", data: docB });
    });
    act(() => {
      store.publish({ syncKey: "branch2:docB", data: docB });
    });

    expect(mockSetHistories).toHaveBeenCalledTimes(2);
  });
});
