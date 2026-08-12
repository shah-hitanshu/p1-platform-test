import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => {
      const status = init?.status ?? 200;
      return { __body: body, status, json: async () => body };
    },
  },
}));

/**
 * Mirrors the real lazy branch resolution: the branch id is only populated by a
 * call made inside runWithAuthToken, and getSharedBranchId returns null until then.
 */
let authToken: string | null = null;
let resolvedBranch: string | null = null;

const listRoutes = vi.fn(async () => {
  if (authToken) resolvedBranch = "branch-1";
  return resolvedBranch ? [{ path: "/blog/page1", kind: "static" }] : [];
});

const queriesList = vi.fn(async () => [{ name: "blog-post", datasource: "d" }]);

vi.mock("@pantheon-systems/puck-css/server", () => ({
  normalizePath: (p: string) => p,
  listRoutes: (...args: unknown[]) => listRoutes(...(args as [])),
  listRouteTemplateKeysFromDatabase: async () => [],
  getPageEditorPreviewParams: () => ({}),
  buildRemoteDatasourceRegistry: () => [{ id: "swapi", label: "SWAPI" }],
  listRemoteDatasourcesForPage: () => ({ global: [], page: [] }),
  cssQueriesToDatasourceDefinitions: (
    queries: { name: string }[],
  ) => queries.map((q) => ({ id: `templates.${q.name}`, label: q.name })),
  getSharedSiteId: () => "site-1",
  getSharedBranchId: () => resolvedBranch,
  createAuthenticatedClient: () => ({ queries: { list: queriesList } }),
  runWithAuthToken: <T>(token: string, fn: () => T): T => {
    const prev = authToken;
    authToken = token;
    try {
      return fn();
    } finally {
      authToken = prev;
    }
  },
}));

import { getEditorContext } from "../routes/editor-context";

type Body = {
  routes: unknown[];
  remoteDatasourceRegistry: { id: string }[];
};

function request(withToken: boolean) {
  return new Request("http://localhost/p1/api/editor-context?path=/blog", {
    headers: withToken ? { Authorization: "Bearer test-token" } : {},
  });
}

describe("getEditorContext auth context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authToken = null;
    resolvedBranch = null;
  });

  it("resolves the branch so template datasources reach the registry", async () => {
    const resp = (await getEditorContext(request(true), {})) as {
      __body: Body;
      status: number;
    };

    expect(resp.status).toBe(200);
    expect(resp.__body.remoteDatasourceRegistry.map((d) => d.id)).toContain(
      "templates.blog-post",
    );
  });

  it("returns the branch's routes rather than an empty list", async () => {
    const resp = (await getEditorContext(request(true), {})) as {
      __body: Body;
    };

    expect(resp.__body.routes).toHaveLength(1);
  });

  it("still responds without a token, minus the template datasources", async () => {
    const resp = (await getEditorContext(request(false), {})) as {
      __body: Body;
      status: number;
    };

    expect(resp.status).toBe(200);
    expect(resp.__body.remoteDatasourceRegistry.map((d) => d.id)).toEqual([
      "swapi",
    ]);
  });
});
