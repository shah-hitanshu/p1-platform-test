import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => {
      const status = init?.status ?? 200;
      return { __body: body, status, json: async () => body };
    },
  },
}));

const mockRoutes = [
  { path: "/about", kind: "static", patchOperations: 0 },
  { path: "/posts/:slug", kind: "template", patchOperations: 0 },
];

vi.mock("@pantheon-systems/puck-css/server", () => ({
  listRoutes: vi.fn(async () => mockRoutes),
  runWithAuthToken: <T>(_token: string, fn: () => T) => fn(),
}));

import { getRoutes } from "../routes/routes-api";

describe("getRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth header", async () => {
    const req = new Request("http://localhost/p1/api/routes");
    const resp = (await getRoutes(req)) as { __body: { error: string }; status: number };
    expect(resp.status).toBe(401);
    expect(resp.__body.error).toBe("unauthorized");
  });

  it("returns routes for an authenticated request", async () => {
    const req = new Request("http://localhost/p1/api/routes", {
      headers: { Authorization: "Bearer test-token" },
    });
    const resp = (await getRoutes(req)) as {
      __body: { routes: typeof mockRoutes };
      status: number;
    };
    expect(resp.status).toBe(200);
    expect(resp.__body.routes).toEqual(mockRoutes);
  });
});
