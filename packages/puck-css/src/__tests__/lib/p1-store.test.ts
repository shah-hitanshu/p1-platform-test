import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock P1Client
// ---------------------------------------------------------------------------

interface MockDocument {
  id: string;
  path: string;
  siteId: string;
  archived: boolean;
}
interface MockVersion {
  id: string;
  documentId: string;
  branchId: string;
  snapshot: Record<string, unknown>;
}

function createMockClient(opts: {
  documents?: MockDocument[];
  versions?: Record<string, MockVersion>;
} = {}) {
  const { documents = [], versions = {} } = opts;

  // Build a path→document lookup for getByPath
  // css-store strips leading "/" via toDocPath(), so store both forms
  const docsByPath = new Map<string, MockDocument>();
  for (const doc of documents) {
    docsByPath.set(doc.path, doc);
    const stripped = doc.path.startsWith("/") ? doc.path.slice(1) : doc.path;
    if (stripped !== doc.path) docsByPath.set(stripped, doc);
  }

  return {
    documents: {
      list: vi.fn().mockResolvedValue(documents),
      getByPath: vi.fn().mockImplementation(async (_siteId: string, path: string) => {
        const doc = docsByPath.get(path);
        if (!doc) throw new Error(`Document not found at path: ${path}`);
        return doc;
      }),
      create: vi.fn().mockImplementation(async (params: { siteId: string; branchId: string; path: string }) => {
        const newDoc = {
          id: `doc-new-${params.path}`,
          path: params.path,
          siteId: params.siteId,
          archived: false,
        };
        docsByPath.set(params.path, newDoc);
        return newDoc;
      }),
      delete: vi.fn().mockImplementation(async () => {}),
    },
    versions: {
      getLatest: vi.fn().mockImplementation(async (_siteId: string, _branchId: string, documentId: string) => {
        const v = versions[documentId];
        if (!v) throw new Error(`No version for ${documentId}`);
        return v;
      }),
      create: vi.fn().mockImplementation(async (_siteId: string, params: { documentId: string; branchId: string; snapshot: Record<string, unknown> }) => ({
        id: `ver-new-${params.documentId}`,
        documentId: params.documentId,
        branchId: params.branchId,
        snapshot: params.snapshot,
      })),
    },
  };
}

type MockP1Client = ReturnType<typeof createMockClient>;

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

import { createP1PageStore, type P1StoreConfig, type P1ContentClientInterface } from "../../data/dal/p1-store";
import { runWithAuthToken } from "../../data/dal/request-auth";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createP1PageStore", () => {
  const SITE_ID = "site-1";
  const BRANCH_ID = "branch-1";

  let mockClient: MockP1Client;

  function makeConfig(client: MockP1Client, contentClient?: P1ContentClientInterface): P1StoreConfig {
    return { client: client as unknown as P1StoreConfig["client"], contentClient, siteId: SITE_ID, branchId: BRANCH_ID };
  }

  function makeContentClient(pages: Record<string, Record<string, unknown>>): P1ContentClientInterface {
    return {
      getPage: vi.fn().mockImplementation(async (path: string) => {
        const data = pages[path] ?? pages["/" + path];
        return data ? { data } : null;
      }),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Factory (synchronous — no hydration)
  // -----------------------------------------------------------------------

  describe("factory", () => {
    it("returns a PageStore without any async init", () => {
      mockClient = createMockClient();
      const store = createP1PageStore(makeConfig(mockClient));
      expect(store).toBeDefined();
      expect(typeof store.get).toBe("function");
      expect(typeof store.set).toBe("function");
      expect(typeof store.delete).toBe("function");
      expect(typeof store.has).toBe("function");
      expect(typeof store.keys).toBe("function");
    });
  });

  // -----------------------------------------------------------------------
  // get
  // -----------------------------------------------------------------------

  describe("get", () => {
    it("returns the snapshot for an existing path via API", async () => {
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      const versions: Record<string, MockVersion> = {
        "doc-1": { id: "v-1", documentId: "doc-1", branchId: BRANCH_ID, snapshot: { root: { props: { title: "Home" } }, content: [] } },
      };
      mockClient = createMockClient({ documents: docs, versions });
      const store = createP1PageStore(makeConfig(mockClient));

      const data = await store.get("/") as Record<string, unknown>;
      expect(data).toBeDefined();
      expect((data.root as Record<string, unknown>).props).toEqual({ title: "Home" });
      expect(mockClient.documents.getByPath).toHaveBeenCalledWith(SITE_ID, "/", BRANCH_ID);
      expect(mockClient.versions.getLatest).toHaveBeenCalledWith(SITE_ID, BRANCH_ID, "doc-1");
    });

    it("returns undefined for a non-existent path", async () => {
      mockClient = createMockClient({ documents: [] });
      const store = createP1PageStore(makeConfig(mockClient));

      expect(await store.get("/nonexistent")).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // get — with content client (published-only reads for public rendering)
  // -----------------------------------------------------------------------

  describe("get — with content client", () => {
    it("uses content client when no auth token is set (public rendering)", async () => {
      const publishedData = { root: { props: { title: "Published" } }, content: [] };
      const contentClient = makeContentClient({ "/": publishedData });

      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      const versions: Record<string, MockVersion> = {
        "doc-1": { id: "v-latest", documentId: "doc-1", branchId: BRANCH_ID, snapshot: { root: { props: { title: "Unpublished draft" } }, content: [] } },
      };
      mockClient = createMockClient({ documents: docs, versions });
      const store = createP1PageStore(makeConfig(mockClient, contentClient));

      const data = await store.get("/") as Record<string, unknown>;
      expect((data.root as Record<string, unknown>).props).toEqual({ title: "Published" });
      expect((contentClient.getPage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("/");
      expect(mockClient.versions.getLatest).not.toHaveBeenCalled();
    });

    it("falls back to versions API when auth token is set (editor context)", async () => {
      const publishedData = { root: { props: { title: "Published" } }, content: [] };
      const contentClient = makeContentClient({ "": publishedData });

      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      const versions: Record<string, MockVersion> = {
        "doc-1": { id: "v-latest", documentId: "doc-1", branchId: BRANCH_ID, snapshot: { root: { props: { title: "Latest draft" } }, content: [] } },
      };
      mockClient = createMockClient({ documents: docs, versions });
      const store = createP1PageStore(makeConfig(mockClient, contentClient));

      let data: unknown;
      await runWithAuthToken("bearer-token-xyz", async () => {
        data = await store.get("/");
      });

      expect((data as Record<string, Record<string, unknown>>).root.props).toEqual({ title: "Latest draft" });
      expect((contentClient.getPage as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
      expect(mockClient.versions.getLatest).toHaveBeenCalled();
    });

    it("returns undefined when content client finds no published version", async () => {
      const contentClient = makeContentClient({});
      mockClient = createMockClient();
      const store = createP1PageStore(makeConfig(mockClient, contentClient));

      expect(await store.get("/unpublished")).toBeUndefined();
      expect((contentClient.getPage as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      expect(mockClient.versions.getLatest).not.toHaveBeenCalled();
    });

    // PCC-3407: the content payload carries a `metadata` object (SeoMetadata,
    // site-level values only — currently just siteName). On public reads the
    // DAL folds it into root.props._seo so it rides the single Data currency
    // through resolvePageData into generateMetadata.
    it("folds content payload metadata into root.props._seo (public rendering)", async () => {
      const metadata = { siteName: "Acme Docs" };
      const contentClient = {
        getPage: vi.fn().mockResolvedValue({
          data: { root: { props: { title: "Published" } }, content: [] },
          metadata,
        }),
      } as unknown as P1ContentClientInterface;
      mockClient = createMockClient();
      const store = createP1PageStore(makeConfig(mockClient, contentClient));

      const data = (await store.get("/")) as {
        root: { props: Record<string, unknown> };
      };
      // Existing props are preserved…
      expect(data.root.props.title).toBe("Published");
      // …and the SEO metadata is attached under _seo.
      expect(data.root.props._seo).toEqual(metadata);
    });

    it("omits _seo when the content payload has no metadata", async () => {
      const contentClient = {
        getPage: vi.fn().mockResolvedValue({
          data: { root: { props: { title: "Published" } }, content: [] },
        }),
      } as unknown as P1ContentClientInterface;
      mockClient = createMockClient();
      const store = createP1PageStore(makeConfig(mockClient, contentClient));

      const data = (await store.get("/")) as {
        root: { props: Record<string, unknown> };
      };
      expect(data.root.props.title).toBe("Published");
      expect("_seo" in data.root.props).toBe(false);
    });

    it("does not attach _seo on the editor path (auth token present)", async () => {
      const contentClient = {
        getPage: vi.fn().mockResolvedValue({
          data: { root: { props: { title: "Published" } }, content: [] },
          metadata: { siteName: "Acme Docs" },
        }),
      } as unknown as P1ContentClientInterface;
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      const versions: Record<string, MockVersion> = {
        "doc-1": {
          id: "v-latest",
          documentId: "doc-1",
          branchId: BRANCH_ID,
          snapshot: { root: { props: { title: "Latest draft" } }, content: [] },
        },
      };
      mockClient = createMockClient({ documents: docs, versions });
      const store = createP1PageStore(makeConfig(mockClient, contentClient));

      let data: unknown;
      await runWithAuthToken("bearer-token-xyz", async () => {
        data = await store.get("/");
      });

      const props = (data as { root: { props: Record<string, unknown> } }).root
        .props;
      expect(props.title).toBe("Latest draft");
      expect("_seo" in props).toBe(false);
      expect(
        contentClient.getPage as ReturnType<typeof vi.fn>,
      ).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // has
  // -----------------------------------------------------------------------

  describe("has", () => {
    it("returns true for an existing path", async () => {
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      mockClient = createMockClient({ documents: docs });
      const store = createP1PageStore(makeConfig(mockClient));

      expect(await store.has("/")).toBe(true);
    });

    it("returns false for a non-existent path", async () => {
      mockClient = createMockClient({ documents: [] });
      const store = createP1PageStore(makeConfig(mockClient));

      expect(await store.has("/nope")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // keys
  // -----------------------------------------------------------------------

  describe("keys", () => {
    it("returns all document paths from the API", async () => {
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
        { id: "doc-2", path: "/about", siteId: SITE_ID, archived: false },
      ];
      mockClient = createMockClient({ documents: docs });
      const store = createP1PageStore(makeConfig(mockClient));

      const keys = await store.keys();
      expect(keys.sort()).toEqual(["/", "/about"]);
      expect(mockClient.documents.list).toHaveBeenCalledWith(SITE_ID, BRANCH_ID);
    });

    it("caches results within the TTL without re-querying", async () => {
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      mockClient = createMockClient({ documents: docs });
      const store = createP1PageStore(makeConfig(mockClient));

      await store.keys();
      await store.keys();
      expect(mockClient.documents.list).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // keys — failure handling (stale-while-error + cooldown)
  // -----------------------------------------------------------------------

  describe("keys — failure handling", () => {
    const TTL_MS = 30_000;
    const COOLDOWN_MS = 30_000;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function makeStore(docs: MockDocument[]) {
      mockClient = createMockClient({ documents: docs });
      return createP1PageStore(makeConfig(mockClient));
    }

    it("serves the last successful result when a refresh fails", async () => {
      const store = makeStore([
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
        { id: "doc-2", path: "/about", siteId: SITE_ID, archived: false },
      ]);

      expect((await store.keys()).sort()).toEqual(["/", "/about"]);

      vi.advanceTimersByTime(TTL_MS + 1);
      mockClient.documents.list.mockRejectedValue(new Error("DB timeout"));

      expect((await store.keys()).sort()).toEqual(["/", "/about"]);
    });

    it("does not retry the query when a stale result is available", async () => {
      const store = makeStore([
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ]);
      await store.keys();

      vi.advanceTimersByTime(TTL_MS + 1);
      mockClient.documents.list.mockRejectedValue(new Error("DB timeout"));
      mockClient.documents.list.mockClear();

      await store.keys();
      expect(mockClient.documents.list).toHaveBeenCalledTimes(1);
    });

    it("does not issue new queries during the failure cooldown", async () => {
      const store = makeStore([
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ]);
      await store.keys();

      vi.advanceTimersByTime(TTL_MS + 1);
      mockClient.documents.list.mockRejectedValue(new Error("DB timeout"));
      await store.keys();

      mockClient.documents.list.mockClear();
      vi.advanceTimersByTime(COOLDOWN_MS / 2);
      expect((await store.keys())).toEqual(["/"]);
      expect((await store.keys())).toEqual(["/"]);
      expect(mockClient.documents.list).not.toHaveBeenCalled();
    });

    it("refreshes after the cooldown expires", async () => {
      const store = makeStore([
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ]);
      await store.keys();

      vi.advanceTimersByTime(TTL_MS + 1);
      mockClient.documents.list.mockRejectedValue(new Error("DB timeout"));
      await store.keys();

      vi.advanceTimersByTime(COOLDOWN_MS + 1);
      mockClient.documents.list.mockResolvedValue([
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
        { id: "doc-3", path: "/new", siteId: SITE_ID, archived: false },
      ]);

      expect((await store.keys()).sort()).toEqual(["/", "/new"]);
    });

    it("returns [] and enters cooldown when there is no prior successful result", async () => {
      const store = makeStore([]);
      mockClient.documents.list.mockRejectedValue(new Error("DB down"));

      // Cold start retries in full (3 retries with backoff timers to flush).
      const first = store.keys();
      await vi.runAllTimersAsync();
      expect(await first).toEqual([]);
      expect(mockClient.documents.list).toHaveBeenCalledTimes(4);

      mockClient.documents.list.mockClear();
      vi.advanceTimersByTime(1000);
      expect(await store.keys()).toEqual([]);
      expect(mockClient.documents.list).not.toHaveBeenCalled();
    });

    it("does not start a second query while a refresh hangs past the TTL", async () => {
      const store = makeStore([
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ]);
      await store.keys();

      vi.advanceTimersByTime(TTL_MS + 1);
      mockClient.documents.list.mockImplementation(() => new Promise(() => {}));
      mockClient.documents.list.mockClear();

      void store.keys();
      vi.advanceTimersByTime(TTL_MS + 1);
      expect(await store.keys()).toEqual(["/"]);
      vi.advanceTimersByTime(TTL_MS + 1);
      expect(await store.keys()).toEqual(["/"]);
      expect(mockClient.documents.list).toHaveBeenCalledTimes(1);
    });

    it("shares one in-flight query when a cold-start refresh hangs", async () => {
      const store = makeStore([]);
      mockClient.documents.list.mockImplementation(() => new Promise(() => {}));

      void store.keys();
      await vi.advanceTimersByTimeAsync(TTL_MS + 1);
      void store.keys();
      await vi.advanceTimersByTimeAsync(1);
      expect(mockClient.documents.list).toHaveBeenCalledTimes(1);
    });

    it("set() clears the cooldown and forces a fresh query", async () => {
      const store = makeStore([
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ]);
      await store.keys();

      vi.advanceTimersByTime(TTL_MS + 1);
      mockClient.documents.list.mockRejectedValue(new Error("DB timeout"));
      await store.keys();

      mockClient.documents.list.mockResolvedValue([
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
        { id: "doc-new-page-2", path: "page-2", siteId: SITE_ID, archived: false },
      ]);
      await store.set("/page-2", { root: { props: {} }, content: [] });

      expect((await store.keys()).sort()).toEqual(["/", "/page-2"]);
    });
  });

  // -----------------------------------------------------------------------
  // set — existing document
  // -----------------------------------------------------------------------

  describe("set — existing document", () => {
    it("creates a new version for an existing document", async () => {
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      mockClient = createMockClient({ documents: docs });
      const store = createP1PageStore(makeConfig(mockClient));

      const newData = { root: { props: { title: "Updated" } }, content: [] };
      await store.set("/", newData);

      expect(mockClient.documents.getByPath).toHaveBeenCalledWith(SITE_ID, "/", BRANCH_ID);
      expect(mockClient.versions.create).toHaveBeenCalledWith(
        SITE_ID,
        expect.objectContaining({
          documentId: "doc-1",
          branchId: BRANCH_ID,
          snapshot: newData,
        }),
      );
    });

    it("does not call documents.create for existing paths", async () => {
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      mockClient = createMockClient({ documents: docs });
      const store = createP1PageStore(makeConfig(mockClient));

      await store.set("/", { root: { props: {} }, content: [] });
      expect(mockClient.documents.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // set — new document
  // -----------------------------------------------------------------------

  describe("set — new document", () => {
    it("creates a document then a version via css-client", async () => {
      mockClient = createMockClient({ documents: [] });
      const store = createP1PageStore(makeConfig(mockClient));

      const newData = { root: { props: { title: "New" } }, content: [] };
      await store.set("/new-page", newData);

      expect(mockClient.documents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: SITE_ID,
          branchId: BRANCH_ID,
          path: "new-page",
        }),
      );
      expect(mockClient.versions.create).toHaveBeenCalledWith(
        SITE_ID,
        expect.objectContaining({
          documentId: "doc-new-new-page",
          branchId: BRANCH_ID,
          snapshot: newData,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  describe("delete", () => {
    it("calls documents.delete on css-client for existing paths", async () => {
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
        { id: "doc-2", path: "/about", siteId: SITE_ID, archived: false },
      ];
      mockClient = createMockClient({ documents: docs });
      const store = createP1PageStore(makeConfig(mockClient));

      await store.delete("/about");
      expect(mockClient.documents.getByPath).toHaveBeenCalledWith(SITE_ID, "about", BRANCH_ID);
      expect(mockClient.documents.delete).toHaveBeenCalledWith(SITE_ID, BRANCH_ID, "doc-2");
    });

    it("is a no-op for non-existent paths", async () => {
      mockClient = createMockClient({ documents: [] });
      const store = createP1PageStore(makeConfig(mockClient));

      await store.delete("/nope");
      expect(mockClient.documents.delete).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Semantic patch entries (stored as-is in snapshot)
  // -----------------------------------------------------------------------

  describe("semantic patch entries", () => {
    it("stores and retrieves semantic patch entries via the API", async () => {
      const semanticEntry = {
        kind: "semantic",
        basePath: "/jedi/:id",
        ops: [{ op: "setRootProp", propPath: "title", value: "Override" }],
      };
      const docs: MockDocument[] = [
        { id: "doc-tpl", path: "/jedi/:id", siteId: SITE_ID, archived: false },
      ];
      const versions: Record<string, MockVersion> = {
        "doc-tpl": { id: "v-tpl", documentId: "doc-tpl", branchId: BRANCH_ID, snapshot: semanticEntry as unknown as Record<string, unknown> },
      };
      mockClient = createMockClient({ documents: docs, versions });
      const store = createP1PageStore(makeConfig(mockClient));

      const entry = await store.get("/jedi/:id") as { kind: string; basePath: string; ops: unknown[] };
      expect(entry.kind).toBe("semantic");
      expect(entry.basePath).toBe("/jedi/:id");
      expect(entry.ops).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Lazy branchId resolution
  // -----------------------------------------------------------------------

  describe("lazy branchId resolution", () => {
    it("resolves branchId via resolveBranchId on first editor operation", async () => {
      const resolveBranchId = vi.fn().mockResolvedValue("branch-resolved");
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      const versions: Record<string, MockVersion> = {
        "doc-1": { id: "v-1", documentId: "doc-1", branchId: "branch-resolved", snapshot: { root: { props: {} }, content: [] } },
      };
      mockClient = createMockClient({ documents: docs, versions });
      const store = createP1PageStore({
        client: mockClient as unknown as P1StoreConfig["client"],
        siteId: SITE_ID,
        resolveBranchId,
      });

      await runWithAuthToken("user-jwt", async () => {
        await store.get("/");
      });

      expect(resolveBranchId).toHaveBeenCalledWith("user-jwt");
      expect(mockClient.versions.getLatest).toHaveBeenCalledWith(SITE_ID, "branch-resolved", "doc-1");
    });

    it("caches the resolved branchId across multiple editor operations", async () => {
      const resolveBranchId = vi.fn().mockResolvedValue("branch-resolved");
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      const versions: Record<string, MockVersion> = {
        "doc-1": { id: "v-1", documentId: "doc-1", branchId: "branch-resolved", snapshot: { root: {}, content: [] } },
      };
      mockClient = createMockClient({ documents: docs, versions });
      const store = createP1PageStore({
        client: mockClient as unknown as P1StoreConfig["client"],
        siteId: SITE_ID,
        resolveBranchId,
      });

      await runWithAuthToken("user-jwt", async () => {
        await store.get("/");
        await store.get("/");
      });

      expect(resolveBranchId).toHaveBeenCalledTimes(1);
    });

    it("retries branch resolution with a fresh token after failure", async () => {
      const resolveBranchId = vi.fn()
        .mockRejectedValueOnce(new Error("token expired"))
        .mockResolvedValue("branch-resolved");
      const docs: MockDocument[] = [
        { id: "doc-1", path: "/", siteId: SITE_ID, archived: false },
      ];
      const versions: Record<string, MockVersion> = {
        "doc-1": { id: "v-1", documentId: "doc-1", branchId: "branch-resolved", snapshot: { root: {}, content: [] } },
      };
      mockClient = createMockClient({ documents: docs, versions });
      const store = createP1PageStore({
        client: mockClient as unknown as P1StoreConfig["client"],
        siteId: SITE_ID,
        resolveBranchId,
      });

      // First attempt fails — _resolvedBranchIdPromise is cleared by the catch handler.
      let caught: Error | undefined;
      try {
        await runWithAuthToken("token-1", async () => {
          await store.set("/", {});
        });
      } catch (err) {
        caught = err as Error;
      }
      expect(caught?.message).toContain("token expired");

      // Second attempt with a different token resolves fresh.
      await runWithAuthToken("token-2", async () => {
        await store.get("/");
      });

      expect(resolveBranchId).toHaveBeenCalledTimes(2);
      expect(resolveBranchId).toHaveBeenLastCalledWith("token-2");
    });

    it("rejects editor operations when no auth token and no branchId configured", async () => {
      mockClient = createMockClient();
      const store = createP1PageStore({
        client: mockClient as unknown as P1StoreConfig["client"],
        siteId: SITE_ID,
        resolveBranchId: vi.fn(),
      });

      // No auth token in context — getBranchId rejects; set() propagates it.
      // Use try/catch to avoid Vitest .rejects.toThrow() compat issue.
      let caught: Error | undefined;
      try {
        await store.set("/", {});
      } catch (err) {
        caught = err as Error;
      }
      expect(caught?.message).toContain("Branch ID required");
    });
  });

  // -----------------------------------------------------------------------
  // Error resilience
  // -----------------------------------------------------------------------

  describe("error resilience", () => {
    it("get returns undefined when API call fails", async () => {
      mockClient = createMockClient();
      mockClient.documents.getByPath.mockRejectedValue(new Error("Network error"));
      const store = createP1PageStore(makeConfig(mockClient));

      expect(await store.get("/")).toBeUndefined();
    });

    it("delete is silent when API call fails", async () => {
      mockClient = createMockClient();
      mockClient.documents.getByPath.mockRejectedValue(new Error("Not found"));
      const store = createP1PageStore(makeConfig(mockClient));

      await expect(store.delete("/nope")).resolves.toBeUndefined();
    });
  });

  // The local withRetry here inspects no status, so before this it retried a bad request
  // four times over ~3s before swallowing it — a missing argument cannot fix itself.
  describe("retry on a bad request", () => {
    it("stops after the first attempt instead of retrying a 400", async () => {
      mockClient = createMockClient();
      const badRequest = Object.assign(new Error('Missing required parameter "branchId"'), {
        status: 400,
      });
      mockClient.documents.list = vi.fn().mockRejectedValue(badRequest);

      const store = createP1PageStore(makeConfig(mockClient));
      await store.keys();

      expect(mockClient.documents.list).toHaveBeenCalledTimes(1);
    });

    it("still retries a transient failure", async () => {
      mockClient = createMockClient();
      mockClient.documents.list = vi.fn().mockRejectedValue(new Error("network down"));

      const store = createP1PageStore(makeConfig(mockClient));
      await store.keys();

      expect(mockClient.documents.list.mock.calls.length).toBeGreaterThan(1);
    });
  });

});
