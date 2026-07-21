import { describe, expect, it, vi, afterEach } from "vitest";

import type { PageStore } from "../../data/dal/types";

vi.mock("../../data/page-editor-meta", () => ({
  removePageEditorMetaPath: vi.fn(),
}));

let storeData: Record<string, unknown> = {};

vi.mock("../../data/dal", () => ({
  getPageStore: vi.fn(() => ({
    get: vi.fn(async (path: string) => storeData[path]),
    set: vi.fn(async (path: string, value: unknown) => { storeData[path] = value; }),
    delete: vi.fn(async (path: string) => { delete storeData[path]; }),
    has: vi.fn(async (path: string) => storeData[path] !== undefined),
    keys: vi.fn(async () => Object.keys(storeData)),
  })),
  getCapabilities: vi.fn(() => ({ branching: true, versioning: true, realtime: true, merge: true })),
  pageStore: {
    get: vi.fn(async (path: string) => storeData[path]),
    set: vi.fn(async (path: string, value: unknown) => { storeData[path] = value; }),
    delete: vi.fn(async (path: string) => { delete storeData[path]; }),
    has: vi.fn(async (path: string) => storeData[path] !== undefined),
    keys: vi.fn(async () => Object.keys(storeData)),
  },
  editorMetaStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  remoteDatasourceDefStore: { list: vi.fn(() => []), save: vi.fn() },
}));

afterEach(() => {
  storeData = {};
});

describe("listRoutes with override store", () => {
  it("uses the override store instead of the global store", async () => {
    const { listRoutes } = await import("../../data/page-store");

    storeData = {
      "/global-page": { root: { props: { title: "Global" } }, content: [], zones: {} },
    };

    const overrideData: Record<string, unknown> = {
      "/branch-page": { root: { props: { title: "Branch" } }, content: [], zones: {} },
    };

    const overrideStore: PageStore = {
      get: async (path: string) => overrideData[path],
      set: async () => {},
      delete: async () => {},
      has: async (path: string) => overrideData[path] !== undefined,
      keys: async () => Object.keys(overrideData),
    };

    const routes = await listRoutes(overrideStore);

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/branch-page");
    expect(routes[0].kind).toBe("static");
  });

  it("falls back to global store when no override is provided", async () => {
    const { listRoutes } = await import("../../data/page-store");

    storeData = {
      "/global-page": { root: { props: { title: "Global" } }, content: [], zones: {} },
    };

    const routes = await listRoutes();

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/global-page");
  });
});

describe("deletePageAtPath with override store", () => {
  it("deletes from override store when provided", async () => {
    const { deletePageAtPath } = await import("../../data/page-store");

    const overrideData: Record<string, unknown> = {
      "/to-delete": { root: { props: { title: "Delete me" } }, content: [], zones: {} },
    };
    const deleteSpy = vi.fn(async (path: string) => { delete overrideData[path]; });
    const overrideStore: PageStore = {
      get: async (path: string) => overrideData[path],
      set: async (path: string, value: unknown) => { overrideData[path] = value; },
      delete: deleteSpy,
      has: async (path: string) => overrideData[path] !== undefined,
      keys: async () => Object.keys(overrideData),
    };

    const result = await deletePageAtPath("/to-delete", overrideStore);

    expect(result.ok).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith("/to-delete");
  });
});
