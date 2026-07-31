/**
 * The applied key is what useP1Editor's write-back guard compares against to
 * decide whether a save targets the document the canvas actually shows. If it
 * is marked before the dispatch and the dispatch fails, the store claims the
 * new document while the canvas still holds the old one — and the guard then
 * waves through a save that writes the old content into the new document.
 * Marking only after a successful dispatch keeps the guard blocking instead.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import type { PuckData } from "@pantheon-systems/css-client";

const mockSetHistories = vi.fn();

let fakePuckState: {
  appState: { data: PuckData; ui: Record<string, unknown>; indexes: Record<string, unknown> };
  history: { setHistories: typeof mockSetHistories };
};

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => (selector: (s: unknown) => unknown) => selector(fakePuckState),
  useGetPuck: () => () => fakePuckState,
}));

const { createDocumentSyncStore, createDocumentSyncPlugin } = await import(
  "../../editor/plugin/document-sync-plugin.js"
);

const docA: PuckData = { root: { props: { title: "A" } }, content: [], zones: {} };
const docB: PuckData = { root: { props: { title: "B" } }, content: [], zones: {} };

function renderPlugin(store: ReturnType<typeof createDocumentSyncStore>) {
  const plugin = createDocumentSyncPlugin(store);
  const PuckOverride = plugin.overrides?.puck as React.FC<{ children: React.ReactNode }>;
  if (!PuckOverride) throw new Error("plugin has no puck override");
  return render(
    <PuckOverride>
      <div>canvas</div>
    </PuckOverride>,
  );
}

beforeEach(() => {
  mockSetHistories.mockReset();
  fakePuckState = {
    appState: { data: docA, ui: { itemSelector: null }, indexes: {} },
    history: { setHistories: mockSetHistories },
  };
});

describe("document sync when the dispatch fails", () => {
  it("leaves the applied key on the document the canvas still shows", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);
    expect(store.getAppliedKey()).toBe("branch1:docA");

    mockSetHistories.mockImplementation(() => {
      throw new Error("puck blew up");
    });

    expect(() =>
      act(() => {
        store.publish({ syncKey: "branch1:docB", data: docB });
      }),
    ).toThrow("puck blew up");

    expect(store.getAppliedKey()).toBe("branch1:docA");
  });

  it("has the new document applied while the dispatch runs", () => {
    // Puck's onChange is a zustand subscriber, so it fires synchronously inside
    // setHistories. That echo must find the applied key already naming the new
    // document, or useP1Editor's write-back guard reports a race on every
    // switch instead of the provider quietly swallowing the echo.
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);

    let appliedDuringDispatch: string | null = null;
    mockSetHistories.mockImplementation(() => {
      appliedDuringDispatch = store.getAppliedKey();
    });

    act(() => {
      store.publish({ syncKey: "branch1:docB", data: docB });
    });

    expect(appliedDuringDispatch).toBe("branch1:docB");
  });

  it("marks the new document applied once the dispatch succeeds", () => {
    const store = createDocumentSyncStore();
    store.publish({ syncKey: "branch1:docA", data: docA });
    renderPlugin(store);

    act(() => {
      store.publish({ syncKey: "branch1:docB", data: docB });
    });

    expect(mockSetHistories).toHaveBeenCalledTimes(1);
    expect(store.getAppliedKey()).toBe("branch1:docB");
  });
});
