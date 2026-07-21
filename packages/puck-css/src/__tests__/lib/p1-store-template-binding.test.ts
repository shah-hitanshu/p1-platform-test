import { describe, expect, it, vi } from "vitest";

// Verifies the server-side persistence path binds a new page to its content
// type template: store.set(path, data, { templateId, templateVersion }) must
// forward the binding to documents.create.

interface MockDocument {
  id: string;
  path: string;
  siteId: string;
  archived: boolean;
}

function createMockClient(documents: MockDocument[] = []) {
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
      create: vi.fn().mockImplementation(async (params: { siteId: string; path: string }) => ({
        id: `doc-new-${params.path}`,
        path: params.path,
        siteId: params.siteId,
        archived: false,
      })),
      delete: vi.fn(),
    },
    versions: {
      getLatest: vi.fn(),
      create: vi.fn().mockImplementation(async (_siteId: string, params: Record<string, unknown>) => ({
        id: "ver-new",
        ...params,
      })),
    },
  };
}

import { createP1PageStore, type P1StoreConfig } from "../../data/dal/p1-store";

const SITE_ID = "site-1";
const BRANCH_ID = "branch-1";

function makeConfig(client: ReturnType<typeof createMockClient>): P1StoreConfig {
  return {
    client: client as unknown as P1StoreConfig["client"],
    siteId: SITE_ID,
    branchId: BRANCH_ID,
  };
}

describe("p1-store set — template binding", () => {
  it("forwards templateId + templateVersion to documents.create for a new page", async () => {
    const mockClient = createMockClient([]);
    const store = createP1PageStore(makeConfig(mockClient));

    await store.set(
      "/oped5",
      { root: { props: {} }, content: [] },
      { templateId: "tmpl-oped", templateVersion: 7 },
    );

    expect(mockClient.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: SITE_ID,
        branchId: BRANCH_ID,
        path: "oped5",
        templateId: "tmpl-oped",
        templateVersion: 7,
      }),
    );
  });
});
