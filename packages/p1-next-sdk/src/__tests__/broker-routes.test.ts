import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => {
      const status = init?.status ?? 200;
      return { __body: body, status, json: async () => body };
    },
  },
}));

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

import { postBrokerLogin, postBrokerRedeem } from "../routes/broker";

function makeRequest(body?: unknown): Request {
  if (body === undefined) {
    return new Request("http://localhost/p1/auth/login", { method: "POST" });
  }
  return new Request("http://localhost/p1/auth/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("postBrokerLogin", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
  });

  it("proxies POST to upstream /broker/login with API key", async () => {
    const upstream = { transactionId: "tx-1", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    const resp = await postBrokerLogin(
      makeRequest(),
      "test-api-key",
      "https://css.example.com",
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://css.example.com/broker/login");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toBe("Bearer test-api-key");

    const body = (resp as { __body: unknown }).__body;
    expect(body).toEqual(upstream);
  });

  it("returns 500 when apiKey is missing", async () => {
    const resp = await postBrokerLogin(makeRequest(), undefined, "https://css.example.com");
    expect((resp as { status: number }).status).toBe(500);
  });

  it("returns 500 when baseUrl is missing", async () => {
    const resp = await postBrokerLogin(makeRequest(), "key", undefined);
    expect((resp as { status: number }).status).toBe(500);
  });

  it("proxies upstream error status", async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(403, { error: "forbidden" }));

    const resp = await postBrokerLogin(makeRequest(), "key", "https://css.example.com");
    expect((resp as { status: number }).status).toBe(403);
    expect((resp as { __body: unknown }).__body).toEqual({ error: "forbidden" });
  });
});

describe("postBrokerRedeem", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
  });

  it("proxies POST to upstream /broker/redeem with transactionId", async () => {
    const upstream = { token: "jwt-broker-token" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    const resp = await postBrokerRedeem(
      makeRequest({ transactionId: "tx-1" }),
      "test-api-key",
      "https://css.example.com",
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://css.example.com/broker/redeem");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toBe("Bearer test-api-key");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ transactionId: "tx-1" });

    const body = (resp as { __body: unknown }).__body;
    expect(body).toEqual(upstream);
  });

  it("returns 400 when transactionId is missing", async () => {
    const resp = await postBrokerRedeem(makeRequest({}), "key", "https://css.example.com");
    expect((resp as { status: number }).status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/p1/auth/redeem", {
      method: "POST",
      body: "not-json",
    });
    const resp = await postBrokerRedeem(req, "key", "https://css.example.com");
    expect((resp as { status: number }).status).toBe(400);
  });

  it("returns 500 when apiKey is missing", async () => {
    const resp = await postBrokerRedeem(makeRequest({ transactionId: "tx-1" }), undefined, "https://css.example.com");
    expect((resp as { status: number }).status).toBe(500);
  });

  it("proxies upstream error status", async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(401, { error: "unauthorized" }));

    const resp = await postBrokerRedeem(
      makeRequest({ transactionId: "tx-1" }),
      "key",
      "https://css.example.com",
    );
    expect((resp as { status: number }).status).toBe(401);
    expect((resp as { __body: unknown }).__body).toEqual({ error: "unauthorized" });
  });
});
