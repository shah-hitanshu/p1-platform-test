import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { createP1PageStore, type P1StoreConfig } from "../../data/dal/p1-store";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createP1PageStore", () => {
  const SITE_ID = "site-1";
  const BRANCH_ID = "branch-1";

  let mockClient: MockP1Client;

  function makeConfig(client: MockP1Client): P1StoreConfig {
    return { client: client as unknown as P1StoreConfig["client"], siteId: SITE_ID, branchId: BRANCH_ID };
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
      expect(mockClient.documents.getByPath).toHaveBeenCalledWith(SITE_ID, "/");
      expect(mockClient.versions.getLatest).toHaveBeenCalledWith(SITE_ID, BRANCH_ID, "doc-1");
    });

    it("returns undefined for a non-existent path", async () => {
      mockClient = createMockClient({ documents: [] });
      const store = createP1PageStore(makeConfig(mockClient));

      expect(await store.get("/nonexistent")).toBeUndefined();
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

      expect(mockClient.documents.getByPath).toHaveBeenCalledWith(SITE_ID, "/");
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
      expect(mockClient.documents.getByPath).toHaveBeenCalledWith(SITE_ID, "about");
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
});
