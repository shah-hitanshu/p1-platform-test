import { describe, it, expect } from "vitest";
import { McpApiClient } from "./css-api.js";

const EDIT_REQUEST = {
  agentId: "agent-abc",
  siteId: "site-1",
  branchId: "branch-1",
  documentPath: "/index",
  trigger: "human_requested" as const,
  intent: "test",
  targetRegions: ["/content"],
};

describe("McpApiClient headers", () => {
  const baseConfig = {
    baseUrl: "https://css.example.com",
    agentId: "agent-abc",
    agentApiKey: "key-xyz",
  };

  it("includes X-Acting-User-Name when actingUser.name is defined", async () => {
    let capturedHeaders: Record<string, string> = {};
    const client = new McpApiClient({
      ...baseConfig,
      actingUser: { id: "user-1", email: "user@example.com", name: "Test User" },
      fetcher: {
        fetch: async (_input, init) => {
          capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    });
    await client.canAgentEdit(EDIT_REQUEST);
    expect(capturedHeaders["X-Acting-User-Id"]).toBe("user-1");
    expect(capturedHeaders["X-Acting-User-Email"]).toBe("user@example.com");
    expect(capturedHeaders["X-Acting-User-Name"]).toBe("Test User");
  });

  it("omits X-Acting-User-Name when actingUser.name is undefined", async () => {
    let capturedHeaders: Record<string, string> = {};
    const client = new McpApiClient({
      ...baseConfig,
      actingUser: { id: "user-1", email: "user@example.com" },
      fetcher: {
        fetch: async (_input, init) => {
          capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    });
    await client.canAgentEdit(EDIT_REQUEST);
    expect(capturedHeaders["X-Acting-User-Id"]).toBe("user-1");
    expect(capturedHeaders["X-Acting-User-Name"]).toBeUndefined();
  });

  it("omits all acting-user headers when actingUser is not set", async () => {
    let capturedHeaders: Record<string, string> = {};
    const client = new McpApiClient({
      ...baseConfig,
      fetcher: {
        fetch: async (_input, init) => {
          capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    });
    await client.canAgentEdit({ ...EDIT_REQUEST, trigger: "autonomous" });
    expect(capturedHeaders["X-Acting-User-Id"]).toBeUndefined();
    expect(capturedHeaders["X-Acting-User-Email"]).toBeUndefined();
    expect(capturedHeaders["X-Acting-User-Name"]).toBeUndefined();
  });
});
