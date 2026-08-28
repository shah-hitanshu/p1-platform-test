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
  PRODUCTION_BASE_URL: "https://ccr.p1.pantheon.io",
}));

const postBrokerLogin = vi.fn(() => ({ __body: { ok: true }, status: 200 }));
const postBrokerRedeem = vi.fn(() => ({ __body: { ok: true }, status: 200 }));
const postBrokerLogout = vi.fn(() => ({ __body: { ok: true }, status: 200 }));
vi.mock("../routes/broker", () => ({
  postBrokerLogin: (...args: unknown[]) => postBrokerLogin(...args),
  postBrokerRedeem: (...args: unknown[]) => postBrokerRedeem(...args),
  postBrokerLogout: (...args: unknown[]) => postBrokerLogout(...args),
}));

import { createP1AuthHandler } from "../auth-handler";

function makeParams(action: string) {
  return { params: Promise.resolve({ action: [action] }) };
}

describe("createP1AuthHandler p1BaseUrl fallback (PCC-3554)", () => {
  beforeEach(() => {
    postBrokerLogin.mockClear();
    postBrokerRedeem.mockClear();
    postBrokerLogout.mockClear();
  });

  it("falls back to PRODUCTION_BASE_URL for login when p1BaseUrl is not configured", async () => {
    const handler = createP1AuthHandler({ p1ApiKey: "key" });
    const req = new Request("http://localhost/p1/auth/login", { method: "POST" });

    await handler.POST(req, makeParams("login"));

    expect(postBrokerLogin).toHaveBeenCalledWith(
      req,
      "key",
      "https://ccr.p1.pantheon.io",
      undefined,
      undefined,
      undefined,
    );
  });

  it("falls back to PRODUCTION_BASE_URL for redeem when p1BaseUrl is not configured", async () => {
    const handler = createP1AuthHandler({ p1ApiKey: "key" });
    const req = new Request("http://localhost/p1/auth/redeem", { method: "POST" });

    await handler.POST(req, makeParams("redeem"));

    expect(postBrokerRedeem).toHaveBeenCalledWith(req, "key", "https://ccr.p1.pantheon.io");
  });

  it("uses the explicit p1BaseUrl when provided, without falling back", async () => {
    const handler = createP1AuthHandler({
      p1ApiKey: "key",
      p1BaseUrl: "https://staging.example.com",
    });
    const req = new Request("http://localhost/p1/auth/login", { method: "POST" });

    await handler.POST(req, makeParams("login"));

    expect(postBrokerLogin).toHaveBeenCalledWith(
      req,
      "key",
      "https://staging.example.com",
      undefined,
      undefined,
      undefined,
    );
  });

  it("routes logout to postBrokerLogout without passing the API key", async () => {
    const handler = createP1AuthHandler({
      p1ApiKey: "key",
      p1BaseUrl: "https://staging.example.com",
    });
    const req = new Request("http://localhost/p1/auth/logout", { method: "POST" });

    await handler.POST(req, makeParams("logout"));

    expect(postBrokerLogout).toHaveBeenCalledWith(req, "https://staging.example.com");
  });

  it("falls back to PRODUCTION_BASE_URL for logout when p1BaseUrl is not configured", async () => {
    const handler = createP1AuthHandler({});
    const req = new Request("http://localhost/p1/auth/logout", { method: "POST" });

    await handler.POST(req, makeParams("logout"));

    expect(postBrokerLogout).toHaveBeenCalledWith(req, "https://ccr.p1.pantheon.io");
  });
});
