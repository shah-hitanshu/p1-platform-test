import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageStore, EditorMetaStore, RemoteDatasourceDefStore } from "../../data/dal/types";

// Reset the module between tests so singleton state doesn't leak
async function freshImport() {
  vi.resetModules();
  return import("../../data/dal/index");
}

describe("DAL initialization system", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Uninitialized stores throw
  // -----------------------------------------------------------------------

  describe("uninitialized access", () => {
    it("getPageStore throws when not initialized", async () => {
      const dal = await freshImport();
      expect(() => dal.getPageStore()).toThrow("not initialized");
    });

    it("getEditorMetaStore throws when not initialized", async () => {
      const dal = await freshImport();
      expect(() => dal.getEditorMetaStore()).toThrow("not initialized");
    });

    it("getRemoteDatasourceDefStore throws when not initialized", async () => {
      const dal = await freshImport();
      expect(() => dal.getRemoteDatasourceDefStore()).toThrow("not initialized");
    });
  });

  // -----------------------------------------------------------------------
  // initializeStores
  // -----------------------------------------------------------------------

  describe("initializeStores", () => {
    it("replaces the PageStore when provided", async () => {
      const dal = await freshImport();
      const custom: PageStore = {
        get: vi.fn(async () => "custom"),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        has: vi.fn(async () => true),
        keys: vi.fn(async () => ["/custom"]),
      };
      dal.initializeStores({ pageStore: custom });
      expect(dal.getPageStore()).toBe(custom);
      expect(await dal.getPageStore().get("/")).toBe("custom");
    });

    it("replaces the EditorMetaStore when provided", async () => {
      const dal = await freshImport();
      const custom: EditorMetaStore = {
        get: () => ({ custom: true }),
        set: vi.fn(),
        delete: vi.fn(),
      };
      dal.initializeStores({ editorMetaStore: custom });
      expect(dal.getEditorMetaStore()).toBe(custom);
    });

    it("replaces the RemoteDatasourceDefStore when provided", async () => {
      const dal = await freshImport();
      const custom: RemoteDatasourceDefStore = {
        list: () => [{ id: "custom" }],
        save: vi.fn(),
      };
      dal.initializeStores({ remoteDatasourceDefStore: custom });
      expect(dal.getRemoteDatasourceDefStore()).toBe(custom);
    });

    it("can be called multiple times to swap stores", async () => {
      const dal = await freshImport();
      const first: PageStore = {
        get: vi.fn(async () => "first"),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        has: vi.fn(async () => true),
        keys: vi.fn(async () => []),
      };
      const second: PageStore = {
        get: vi.fn(async () => "second"),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        has: vi.fn(async () => true),
        keys: vi.fn(async () => []),
      };
      dal.initializeStores({ pageStore: first });
      expect(await dal.getPageStore().get("/")).toBe("first");
      dal.initializeStores({ pageStore: second });
      expect(await dal.getPageStore().get("/")).toBe("second");
    });
  });

  // -----------------------------------------------------------------------
  // getCapabilities
  // -----------------------------------------------------------------------

  describe("getCapabilities", () => {
    it("reports all capabilities as enabled", async () => {
      const dal = await freshImport();
      const caps = dal.getCapabilities();
      expect(caps.branching).toBe(true);
      expect(caps.versioning).toBe(true);
      expect(caps.realtime).toBe(true);
      expect(caps.merge).toBe(true);
    });
  });
});
