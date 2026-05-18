import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => {
      const status = init?.status ?? 200;
      return { __body: body, status, json: async () => body };
    },
  },
}));

vi.mock("@pantheon-systems/puck-css/server", () => ({
  ensureInitialized: () => Promise.resolve(),
  runWithAuthToken: <T>(_token: string, fn: () => T) => fn(),
}));

vi.mock("../handler-actions", () => ({
  getPageData: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  getRemoteDatasources: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  getEditorContext: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  getDatasourceContext: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  postPublish: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  postResolvePreview: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  postPreviewMeta: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  postRemoteDatasources: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  postStructure: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  deleteRemoteDatasources: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
  deleteStructurePage: vi.fn(() => ({ __body: { ok: true }, status: 200 })),
}));

import { createP1Handler } from "../handler";
import type { Config } from "@puckeditor/core";

const handler = createP1Handler({ config: {} as Config });

function makeParams(...segments: string[]) {
  return { params: Promise.resolve({ p1: segments }) };
}

describe("withAuth 401 enforcement", () => {
  describe("POST routes require auth", () => {
    it("returns 401 for POST /publish without Authorization header", async () => {
      const req = new Request("http://localhost/p1/api/publish", { method: "POST" });
      const resp = await handler.POST(req, makeParams("publish")) as { status: number };
      expect(resp.status).toBe(401);
    });

    it("returns 401 for POST /datasources without Authorization header", async () => {
      const req = new Request("http://localhost/p1/api/datasources", { method: "POST" });
      const resp = await handler.POST(req, makeParams("datasources")) as { status: number };
      expect(resp.status).toBe(401);
    });

    it("returns 401 for POST /structure/page without Authorization header", async () => {
      const req = new Request("http://localhost/p1/api/structure/page", { method: "POST" });
      const resp = await handler.POST(req, makeParams("structure", "page")) as { status: number };
      expect(resp.status).toBe(401);
    });
  });

  describe("DELETE routes require auth", () => {
    it("returns 401 for DELETE /datasources without Authorization header", async () => {
      const req = new Request("http://localhost/p1/api/datasources", { method: "DELETE" });
      const resp = await handler.DELETE(req, makeParams("datasources")) as { status: number };
      expect(resp.status).toBe(401);
    });

    it("returns 401 for DELETE /structure/page without Authorization header", async () => {
      const req = new Request("http://localhost/p1/api/structure/page", { method: "DELETE" });
      const resp = await handler.DELETE(req, makeParams("structure", "page")) as { status: number };
      expect(resp.status).toBe(401);
    });
  });

  describe("authenticated requests succeed", () => {
    it("allows POST /publish with a valid Bearer token", async () => {
      const req = new Request("http://localhost/p1/api/publish", {
        method: "POST",
        headers: { Authorization: "Bearer valid-token-123" },
      });
      const resp = await handler.POST(req, makeParams("publish")) as { status: number };
      expect(resp.status).toBe(200);
    });

    it("allows DELETE /structure/page with a valid Bearer token", async () => {
      const req = new Request("http://localhost/p1/api/structure/page", {
        method: "DELETE",
        headers: { Authorization: "Bearer valid-token-123" },
      });
      const resp = await handler.DELETE(req, makeParams("structure", "page")) as { status: number };
      expect(resp.status).toBe(200);
    });
  });

  describe("GET routes remain open", () => {
    it("allows GET /page-data without Authorization header", async () => {
      const req = new Request("http://localhost/p1/api/page-data");
      const resp = await handler.GET(req, makeParams("page-data")) as { status: number };
      expect(resp.status).toBe(200);
    });

    it("allows GET /datasources without Authorization header", async () => {
      const req = new Request("http://localhost/p1/api/datasources");
      const resp = await handler.GET(req, makeParams("datasources")) as { status: number };
      expect(resp.status).toBe(200);
    });
  });
});
