import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetRedirect = vi.fn();

vi.mock("@pantheon-systems/css-client/content", () => ({
  P1ContentClient: class MockP1ContentClient {
    getRedirect = mockGetRedirect;
  },
}));

vi.mock("next/server", () => {
  const redirect = (url: string | URL, status: number) => ({
    type: "redirect" as const,
    url: typeof url === "string" ? url : url.toString(),
    status,
  });
  const next = () => ({ type: "next" as const });
  return {
    NextResponse: { redirect, next },
  };
});

import { createP1Middleware } from "../middleware";

describe("createP1Middleware", () => {
  beforeEach(() => {
    mockGetRedirect.mockReset();
  });

  const config = {
    cssBaseUrl: "http://localhost:8787",
    apiToken: "test-token",
    siteId: "site-1",
  };

  it("should redirect when a redirect exists for the path", async () => {
    mockGetRedirect.mockResolvedValueOnce({
      fromPath: "/old-page",
      destination: "/new-page",
      redirectType: "permanent",
      parenting: false,
      statusCode: 301,
    });

    const middleware = createP1Middleware(config);
    const request = new Request("http://localhost:3000/old-page");
    const result = await middleware(request) as { type: string; url: string; status: number };

    expect(result.type).toBe("redirect");
    expect(result.url).toBe("http://localhost:3000/new-page");
    expect(result.status).toBe(301);
    expect(mockGetRedirect).toHaveBeenCalledWith("/old-page");
  });

  it("should use 302 for temporary redirects", async () => {
    mockGetRedirect.mockResolvedValueOnce({
      fromPath: "/temp",
      destination: "/new-temp",
      redirectType: "temporary",
      parenting: false,
      statusCode: 302,
    });

    const middleware = createP1Middleware(config);
    const request = new Request("http://localhost:3000/temp");
    const result = await middleware(request) as { type: string; status: number };

    expect(result.type).toBe("redirect");
    expect(result.status).toBe(302);
  });

  it("should pass through when no redirect exists", async () => {
    mockGetRedirect.mockResolvedValueOnce(null);

    const middleware = createP1Middleware(config);
    const request = new Request("http://localhost:3000/normal-page");
    const result = await middleware(request) as { type: string };

    expect(result.type).toBe("next");
  });

  it("should skip /p1/ routes", async () => {
    const middleware = createP1Middleware(config);
    const request = new Request("http://localhost:3000/p1/api/page-data");
    const result = await middleware(request) as { type: string };

    expect(result.type).toBe("next");
    expect(mockGetRedirect).not.toHaveBeenCalled();
  });

  it("should skip /_next/ routes", async () => {
    const middleware = createP1Middleware(config);
    const request = new Request("http://localhost:3000/_next/static/chunk.js");
    const result = await middleware(request) as { type: string };

    expect(result.type).toBe("next");
    expect(mockGetRedirect).not.toHaveBeenCalled();
  });

  it("should skip /api/ routes", async () => {
    const middleware = createP1Middleware(config);
    const request = new Request("http://localhost:3000/api/health");
    const result = await middleware(request) as { type: string };

    expect(result.type).toBe("next");
    expect(mockGetRedirect).not.toHaveBeenCalled();
  });

  it("should pass through on getRedirect error", async () => {
    mockGetRedirect.mockRejectedValueOnce(new Error("Network error"));

    const middleware = createP1Middleware(config);
    const request = new Request("http://localhost:3000/old-page");
    const result = await middleware(request) as { type: string };

    expect(result.type).toBe("next");
  });

  it("should handle absolute destination URLs", async () => {
    mockGetRedirect.mockResolvedValueOnce({
      fromPath: "/external",
      destination: "https://example.com/landing",
      redirectType: "permanent",
      parenting: false,
      statusCode: 301,
    });

    const middleware = createP1Middleware(config);
    const request = new Request("http://localhost:3000/external");
    const result = await middleware(request) as { type: string; url: string; status: number };

    expect(result.type).toBe("redirect");
    expect(result.url).toBe("https://example.com/landing");
    expect(result.status).toBe(301);
  });
});
