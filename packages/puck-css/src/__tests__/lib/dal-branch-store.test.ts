import { afterEach, describe, expect, it, vi } from "vitest";

describe("createPageStoreForBranch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("throws when ensureInitialized has not been called", async () => {
    const { createPageStoreForBranch } = await import("../../data/dal/init");
    expect(() => createPageStoreForBranch("branch-123")).toThrow(
      "not initialized"
    );
  });

  it("creates a PageStore that uses the specified branchId", async () => {
    vi.resetModules();

    const mockDocuments = [
      { id: "doc-1", path: "page-a" },
      { id: "doc-2", path: "page-b" },
    ];

    const listDocsSpy = vi.fn().mockResolvedValue(mockDocuments);

    vi.doMock("@pantheon-systems/css-client", () => ({
      P1Client: class {
        branches = { list: vi.fn().mockResolvedValue([{ id: "main-branch", isMain: true }]) };
        documents = { list: listDocsSpy, getByPath: vi.fn(), create: vi.fn(), delete: vi.fn() };
        versions = { getLatest: vi.fn(), create: vi.fn() };
      },
      P1ContentClient: class {
        getPage = vi.fn();
      },
    }));

    const { ensureInitialized, createPageStoreForBranch, _resetInit } = await import(
      "../../data/dal/init"
    );

    _resetInit();

    await ensureInitialized({
      p1BaseUrl: "http://test",
      p1SiteId: "site-1",
      p1ApiKey: "key-1",
    });

    const store = createPageStoreForBranch("feature-branch");
    const keys = await store.keys();

    expect(listDocsSpy).toHaveBeenCalledWith("site-1", "feature-branch");
    expect(keys).toEqual(["/page-a", "/page-b"]);
  });

  it("creates independent stores for different branches", async () => {
    vi.resetModules();

    const listDocsSpy = vi.fn()
      .mockImplementation((_siteId: string, branchId: string) => {
        if (branchId === "branch-a") {
          return Promise.resolve([{ id: "doc-a", path: "only-on-a" }]);
        }
        return Promise.resolve([{ id: "doc-b", path: "only-on-b" }]);
      });

    vi.doMock("@pantheon-systems/css-client", () => ({
      P1Client: class {
        branches = { list: vi.fn().mockResolvedValue([{ id: "main-branch", isMain: true }]) };
        documents = { list: listDocsSpy, getByPath: vi.fn(), create: vi.fn(), delete: vi.fn() };
        versions = { getLatest: vi.fn(), create: vi.fn() };
      },
      P1ContentClient: class {
        getPage = vi.fn();
      },
    }));

    const { ensureInitialized, createPageStoreForBranch, _resetInit } = await import(
      "../../data/dal/init"
    );

    _resetInit();

    await ensureInitialized({
      p1BaseUrl: "http://test",
      p1SiteId: "site-1",
      p1ApiKey: "key-1",
    });

    const storeA = createPageStoreForBranch("branch-a");
    const storeB = createPageStoreForBranch("branch-b");

    const keysA = await storeA.keys();
    const keysB = await storeB.keys();

    expect(keysA).toEqual(["/only-on-a"]);
    expect(keysB).toEqual(["/only-on-b"]);
  });
});
