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

import { postBrokerLogin, postBrokerLogout, postBrokerRedeem } from "../routes/broker";

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

// Simulates the real deployment shape (confirmed via a live diagnostic behind
// Pantheon's proxy): the Next.js server sees its own bind address
// (https://localhost:3000 -- the scheme is already correct, only the host is
// wrong) as request.url, while the reverse proxy forwards the real public
// host in a header.
function makeProxiedRequest(headers: Record<string, string>): Request {
  return new Request("https://localhost:3000/p1/auth/login", {
    method: "POST",
    headers,
  });
}

// Simulates genuine local development (no reverse proxy): request.url's
// scheme and host are both already correct and must be left alone.
function makeLocalDevRequest(host: string): Request {
  return new Request(`http://${host}/p1/auth/login`, {
    method: "POST",
    headers: { host },
  });
}

function makeLoginRequest(body?: unknown): Request {
  if (body === undefined) {
    return new Request("http://localhost/p1/auth/login", { method: "POST" });
  }
  return new Request("http://localhost/p1/auth/login", {
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

  it("forwards redirectUrl to upstream when provided in options", async () => {
    const upstream = { transactionId: "tx-1", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    const resp = await postBrokerLogin(
      makeRequest(),
      "test-api-key",
      "https://css.example.com",
      undefined,
      "https://myapp.example.com/p1/editor",
    );

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://css.example.com/broker/login");
    const body = JSON.parse(opts.body);
    expect(body.redirectUrl).toBe("https://myapp.example.com/p1/editor");

    const respBody = (resp as { __body: unknown }).__body;
    expect(respBody).toEqual(upstream);
  });

  it("auto-derives redirectUrl from request origin and app base path", async () => {
    const upstream = { transactionId: "tx-2", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    await postBrokerLogin(makeRequest(), "key", "https://css.example.com");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.redirectUrl).toBe("http://localhost/p1");
  });

  it("uses p1SiteUrl origin for redirectUrl when provided", async () => {
    const upstream = { transactionId: "tx-3", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    await postBrokerLogin(
      makeRequest(),
      "key",
      "https://css.example.com",
      "https://mysite.pantheonsite.io",
    );

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.redirectUrl).toBe("https://mysite.pantheonsite.io/p1");
  });

  it("PCC-3574: falls back to the request's own origin, without throwing, when p1SiteUrl is malformed", async () => {
    const upstream = { transactionId: "tx-3b", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const request = makeProxiedRequest({ host: "mysite.pantheonsite.io" });
    await postBrokerLogin(request, "key", "https://css.example.com", "not-a-valid-url");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.redirectUrl).toBe("https://mysite.pantheonsite.io/p1");
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it("falls back to request.url origin when p1SiteUrl is not provided", async () => {
    const upstream = { transactionId: "tx-4", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    await postBrokerLogin(makeRequest(), "key", "https://css.example.com", undefined);

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.redirectUrl).toBe("http://localhost/p1");
  });

  it("PCC-3574: derives the redirect from the host header instead of request.url's own (proxy-local) origin", async () => {
    const upstream = { transactionId: "tx-7", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    const request = makeProxiedRequest({ host: "mysite.pantheonsite.io" });
    await postBrokerLogin(request, "key", "https://css.example.com");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    // Not "https://localhost:3000/p1" -- that's the bug this test guards against.
    expect(body.redirectUrl).toBe("https://mysite.pantheonsite.io/p1");
  });

  it("SECURITY (PCC-3574): ignores x-forwarded-host -- it is not validated by Pantheon's edge and is trivially spoofable", async () => {
    const upstream = { transactionId: "tx-8b", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    // Confirmed empirically against a live Pantheon-hosted site: an arbitrary
    // Host is 404'd upstream (edge-validated), but an arbitrary
    // X-Forwarded-Host sails through untouched alongside a legitimate Host.
    // Preferring it, as an earlier draft of this fix did, is an open
    // redirect: any caller can point a real login flow at an attacker
    // origin. Only `host` may ever be trusted here.
    const request = makeProxiedRequest({
      "x-forwarded-host": "evil.attacker.example.com",
      host: "mysite.pantheonsite.io",
    });
    await postBrokerLogin(request, "key", "https://css.example.com");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.redirectUrl).toBe("https://mysite.pantheonsite.io/p1");
  });

  it("SECURITY (PCC-3574): does not fall back to x-forwarded-host even when host is absent", async () => {
    const upstream = { transactionId: "tx-8d", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    // Closes the gap in the test above: proves there is no fallback path to
    // x-forwarded-host at all, not just that host wins when both are present.
    const request = makeProxiedRequest({ "x-forwarded-host": "evil.attacker.example.com" });
    await postBrokerLogin(request, "key", "https://css.example.com");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    // Falls all the way back to request.url's own (proxy-local) origin --
    // still wrong in this deployment shape, but not attacker-directable.
    expect(body.redirectUrl).toBe("https://localhost:3000/p1");
  });

  it("PCC-3574: preserves an http scheme in genuine local dev (no reverse proxy)", async () => {
    const upstream = { transactionId: "tx-8c", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    // A host that does NOT start with the literal string "localhost" --
    // 127.0.0.1, host.docker.internal, a LAN IP for phone testing, etc. are
    // all common ways to reach a local dev server and must stay http too.
    const request = makeLocalDevRequest("127.0.0.1:3000");
    await postBrokerLogin(request, "key", "https://css.example.com");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    // Must stay http -- a hostname-prefix guess would force this to https.
    expect(body.redirectUrl).toBe("http://127.0.0.1:3000/p1");
  });

  it("PCC-3574: still prefers p1SiteUrl over the host header when both are present", async () => {
    const upstream = { transactionId: "tx-9", loginUrl: "https://auth0.example.com/login" };
    fetchSpy.mockResolvedValueOnce(okResponse(upstream));

    const request = makeProxiedRequest({ host: "wrong-host.example.com" });
    await postBrokerLogin(request, "key", "https://css.example.com", "https://mysite.pantheonsite.io");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.redirectUrl).toBe("https://mysite.pantheonsite.io/p1");
  });

  it("PCC-3574: does not warn in production when the host header is present, even without p1SiteUrl", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx-10" }));
    const request = makeProxiedRequest({ host: "mysite.pantheonsite.io" });
    await postBrokerLogin(request, "key", "https://css.example.com");

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  it("warns in production when p1SiteUrl is not set", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx-5" }));
    await postBrokerLogin(makeRequest(), "key", "https://css.example.com");

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("p1SiteUrl");

    warnSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  it("does not warn when p1SiteUrl is provided in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx-6" }));
    await postBrokerLogin(
      makeRequest(),
      "key",
      "https://css.example.com",
      "https://mysite.pantheonsite.io",
    );

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  // PCC-3531: request.url resolves to an internal listener on Pantheon, which is
  // why redirects land on localhost. The browser sends the real origin; CCR decides
  // whether to trust it. This handler never decides.
  describe("proposedRedirectUrl (PCC-3531)", () => {
    function upstreamBody(callIndex = 0): Record<string, unknown> {
      const [, opts] = fetchSpy.mock.calls[callIndex];
      return JSON.parse(opts.body);
    }

    it("proposes the browser origin when no explicit config exists", async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx", loginUrl: "u" }));

      await postBrokerLogin(
        makeLoginRequest({ origin: "https://live-mysite.pantheonsite.io" }),
        "key",
        "https://css.example.com",
      );

      const body = upstreamBody();
      // The status-quo value still goes up, so a rejected proposal changes nothing.
      expect(body.redirectUrl).toBe("http://localhost/p1");
      expect(body.proposedRedirectUrl).toBe("https://live-mysite.pantheonsite.io/p1");
    });

    // The compatibility guarantee, asserted on the wire rather than in intent.
    it("sends no proposal at all when p1SiteUrl is configured", async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx", loginUrl: "u" }));

      await postBrokerLogin(
        makeLoginRequest({ origin: "https://live-mysite.pantheonsite.io" }),
        "key",
        "https://css.example.com",
        "https://www.configured.com",
      );

      const body = upstreamBody();
      expect(body.redirectUrl).toBe("https://www.configured.com/p1");
      expect(body).not.toHaveProperty("proposedRedirectUrl");
    });

    it("sends no proposal when an explicit redirectUrl is configured", async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx", loginUrl: "u" }));

      await postBrokerLogin(
        makeLoginRequest({ origin: "https://live-mysite.pantheonsite.io" }),
        "key",
        "https://css.example.com",
        undefined,
        "https://explicit.example.com/callback",
      );

      const body = upstreamBody();
      expect(body.redirectUrl).toBe("https://explicit.example.com/callback");
      expect(body).not.toHaveProperty("proposedRedirectUrl");
    });

    it("behaves exactly as before when the request carries no body", async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx", loginUrl: "u" }));

      await postBrokerLogin(makeLoginRequest(), "key", "https://css.example.com");

      const body = upstreamBody();
      expect(body.redirectUrl).toBe("http://localhost/p1");
      expect(body).not.toHaveProperty("proposedRedirectUrl");
    });

    it("ignores a body that is not valid JSON", async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx", loginUrl: "u" }));

      const request = new Request("http://localhost/p1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      await postBrokerLogin(request, "key", "https://css.example.com");

      const body = upstreamBody();
      expect(body.redirectUrl).toBe("http://localhost/p1");
      expect(body).not.toHaveProperty("proposedRedirectUrl");
    });

    it.each([
      ["a non-string origin", 42],
      ["an origin with a path", "https://evil.example/wp-admin"],
      ["a relative value", "/p1"],
      ["an unparseable value", "not-a-url"],
      ["an empty string", ""],
    ])("does not forward %s as a proposal", async (_label, origin) => {
      fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx", loginUrl: "u" }));

      await postBrokerLogin(
        makeLoginRequest({ origin }),
        "key",
        "https://css.example.com",
      );

      const body = upstreamBody();
      expect(body).not.toHaveProperty("proposedRedirectUrl");
    });

    // CCR warns alongside a normal 200 when it declines; swallowing that would
    // leave the operator with the same mystery localhost redirect.
    it("logs a warning returned by the broker and passes the body through", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const upstream = {
        transactionId: "tx",
        loginUrl: "u",
        warning: "proposed origin https://evil.example is not registered for this site; ignoring it",
      };
      fetchSpy.mockResolvedValueOnce(okResponse(upstream));

      const resp = await postBrokerLogin(
        makeLoginRequest({ origin: "https://evil.example" }),
        "key",
        "https://css.example.com",
      );

      expect(warn).toHaveBeenCalled();
      const logged = warn.mock.calls.map((c) => c.join(" ")).join(" ");
      expect(logged).toContain("[P1AuthHandler]");
      expect(logged).toContain("https://evil.example");

      // Not echoed to the caller: /p1/auth/login is public, so returning it would
      // let anyone probe whether an origin is registered for a site.
      const returned = (resp as { __body: Record<string, unknown> }).__body;
      expect(returned.transactionId).toBe("tx");
      expect(returned.loginUrl).toBe("u");
      expect(returned).not.toHaveProperty("warning");
      warn.mockRestore();
    });

    it("does not log when the broker returns no warning", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx", loginUrl: "u" }));

      await postBrokerLogin(
        makeLoginRequest({ origin: "https://live-mysite.pantheonsite.io" }),
        "key",
        "https://css.example.com",
      );

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("preserves the app base path when composing the proposal", async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ transactionId: "tx", loginUrl: "u" }));

      const request = new Request("http://localhost/nested/base/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: "https://live-mysite.pantheonsite.io" }),
      });
      await postBrokerLogin(request, "key", "https://css.example.com");

      const body = upstreamBody();
      expect(body.redirectUrl).toBe("http://localhost/nested/base");
      expect(body.proposedRedirectUrl).toBe("https://live-mysite.pantheonsite.io/nested/base");
    });
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

describe("postBrokerLogout", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
  });

  function logoutRequest(
    headers: Record<string, string> = { authorization: "Bearer broker-jwt" },
    body = JSON.stringify({ returnTo: "https://mysite.example.com" }),
  ): Request {
    return new Request("http://localhost/p1/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
  }

  it("forwards the caller's Authorization and never attaches an API key", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ logoutUrl: "https://auth0.example.com/v2/logout" }));

    const resp = await postBrokerLogout(logoutRequest(), "https://css.example.com");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://css.example.com/broker/logout");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer broker-jwt");
    // Logout authenticates with the browser's broker JWT; there is no secret here.
    expect(JSON.stringify(headers)).not.toContain("key");
    expect((resp as { __body: unknown }).__body).toEqual({
      logoutUrl: "https://auth0.example.com/v2/logout",
    });
  });

  it("forwards the request body through to the broker", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ logoutUrl: "https://auth0.example.com/v2/logout" }));

    await postBrokerLogout(logoutRequest(), "https://css.example.com");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ returnTo: "https://mysite.example.com" });
  });

  it("returns 401 without calling upstream when Authorization is absent", async () => {
    const resp = await postBrokerLogout(logoutRequest({}), "https://css.example.com");

    expect((resp as { status: number }).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when baseUrl is missing", async () => {
    const resp = await postBrokerLogout(logoutRequest(), undefined);

    expect((resp as { status: number }).status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proxies upstream error status", async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(403, { error: "Broker JWT required" }));

    const resp = await postBrokerLogout(logoutRequest(), "https://css.example.com");

    expect((resp as { status: number }).status).toBe(403);
    expect((resp as { __body: unknown }).__body).toEqual({ error: "Broker JWT required" });
  });

  // Same reasoning as login: the warning names whether an origin is registered
  // for a site, so it is logged and stripped rather than echoed to the browser.
  it("strips the warning field from a successful response", async () => {
    fetchSpy.mockResolvedValueOnce(
      okResponse({ logoutUrl: "https://auth0.example.com/v2/logout", warning: "origin not registered" }),
    );

    const resp = await postBrokerLogout(logoutRequest(), "https://css.example.com");

    expect((resp as { __body: Record<string, unknown> }).__body).toEqual({
      logoutUrl: "https://auth0.example.com/v2/logout",
    });
  });

  it("survives a non-JSON upstream body", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("not json", { status: 502 }));

    const resp = await postBrokerLogout(logoutRequest(), "https://css.example.com");

    expect((resp as { status: number }).status).toBe(502);
    expect((resp as { __body: unknown }).__body).toEqual({ error: "Unknown error" });
  });
});
