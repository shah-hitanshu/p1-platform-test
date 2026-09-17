import { describe, it, expect } from "vitest";
import { McpApiClient, isAgentTurnStopped, type CcrApiError } from "./api-client.js";

const EDIT_REQUEST = {
  agentId: "agent-abc",
  siteId: "site-1",
  branchId: "branch-1",
  documentPath: "/index",
  trigger: "human_requested" as const,
  intent: "test",
  targetRegions: ["/content"],
};

describe("McpApiClient request bounds", () => {
  it("gives every request a timeout signal", async () => {
    let capturedInit: RequestInit | undefined;
    const client = new McpApiClient({
      baseUrl: "https://css.example.com",
      agentId: "agent-abc",
      agentApiKey: "key-xyz",
      fetcher: {
        fetch: async (_input, init) => {
          capturedInit = init;
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    });
    await client.canAgentEdit(EDIT_REQUEST);
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("McpApiClient headers", () => {
  const baseConfig = {
    baseUrl: "https://ccr.example.com",
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

// ---------------------------------------------------------------------------
// Document path encoding — every edit-flow method routes the raw documentPath
// (leading slash and all) through buildDocumentUrl's encodeURIComponent,
// matching collaborative-state-system/workers/mcp-server's reference
// McpApiClient exactly: no client-side leading-slash stripping. The backend's
// route regex captures multi-segment paths and unconditionally
// decodeURIComponent()s them (see realtime-utils.ts parseRoute) before its own
// authoritative normalizePath runs, so this is safe for the root path "/" and
// for nested paths alike.
// ---------------------------------------------------------------------------

describe("McpApiClient document path encoding", () => {
  const baseConfig = {
    baseUrl: "https://ccr.example.com",
    agentId: "agent-abc",
    agentApiKey: "key-xyz",
  };

  function captureUrlClient(body: unknown): { client: McpApiClient; getUrl: () => string } {
    let capturedUrl = "";
    const client = new McpApiClient({
      ...baseConfig,
      fetcher: {
        fetch: async (input) => {
          capturedUrl = String(input);
          return new Response(JSON.stringify(body), { status: 200 });
        },
      },
    });
    return { client, getUrl: () => capturedUrl };
  }

  it("canAgentEdit encodes the root document path as %2F", async () => {
    const { client, getUrl } = captureUrlClient({ allowed: true });
    await client.canAgentEdit({ ...EDIT_REQUEST, documentPath: "/" });
    expect(getUrl()).toBe(
      "https://ccr.example.com/api/sites/site-1/branches/branch-1/documents/%2F/can-agent-edit",
    );
  });

  it("startAgentEdit encodes the root document path as %2F", async () => {
    const { client, getUrl } = captureUrlClient({ editSessionId: "s1", checkpointId: "c1", expiresAt: "", reservedRegions: [] });
    await client.startAgentEdit({ ...EDIT_REQUEST, documentPath: "/" });
    expect(getUrl()).toBe(
      "https://ccr.example.com/api/sites/site-1/branches/branch-1/documents/%2F/agent-edit-start",
    );
  });

  it("applyEdits encodes the root document path as %2F", async () => {
    const { client, getUrl } = captureUrlClient({ success: true });
    await client.applyEdits({
      siteId: "site-1",
      branchId: "branch-1",
      documentPath: "/",
      editSessionId: "session-1",
      operations: [],
    });
    expect(getUrl()).toBe(
      "https://ccr.example.com/api/sites/site-1/branches/branch-1/documents/%2F/edits",
    );
  });

  it("completeAgentEdit encodes the root document path as %2F", async () => {
    const { client, getUrl } = captureUrlClient({ success: true, checkpointId: "c1" });
    await client.completeAgentEdit({
      siteId: "site-1",
      branchId: "branch-1",
      documentPath: "/",
      editSessionId: "session-1",
    });
    expect(getUrl()).toBe(
      "https://ccr.example.com/api/sites/site-1/branches/branch-1/documents/%2F/agent-edit-complete",
    );
  });

  it("abortAgentEdit encodes the root document path as %2F", async () => {
    const { client, getUrl } = captureUrlClient({ success: true, rolledBack: true });
    await client.abortAgentEdit({
      siteId: "site-1",
      branchId: "branch-1",
      documentPath: "/",
      editSessionId: "session-1",
    });
    expect(getUrl()).toBe(
      "https://ccr.example.com/api/sites/site-1/branches/branch-1/documents/%2F/agent-edit-abort",
    );
  });

  it("encodes a leading slash on non-root documents rather than stripping it", async () => {
    // No client-side normalization — the raw path is encoded wholesale, exactly
    // like the reference client. The backend's own normalizePath (which strips
    // leading slashes) runs server-side after decodeURIComponent.
    const { client, getUrl } = captureUrlClient({ allowed: true });
    await client.canAgentEdit({ ...EDIT_REQUEST, documentPath: "/about" });
    expect(getUrl()).toBe(
      "https://ccr.example.com/api/sites/site-1/branches/branch-1/documents/%2Fabout/can-agent-edit",
    );
  });

  it("encodes every slash in a nested document path as one opaque token", async () => {
    const { client, getUrl } = captureUrlClient({ allowed: true });
    await client.canAgentEdit({ ...EDIT_REQUEST, documentPath: "/blog/post" });
    expect(getUrl()).toBe(
      "https://ccr.example.com/api/sites/site-1/branches/branch-1/documents/%2Fblog%2Fpost/can-agent-edit",
    );
  });
});

describe("McpApiClient template lookups", () => {
  const baseConfig = {
    baseUrl: "https://ccr.example.com",
    agentId: "agent-abc",
    agentApiKey: "key-xyz",
  };

  it("lookupDocumentByPath hits the by-path endpoint and returns templateId", async () => {
    let capturedUrl = "";
    const client = new McpApiClient({
      ...baseConfig,
      fetcher: {
        fetch: async (input) => {
          capturedUrl = String(input);
          return new Response(
            JSON.stringify({ id: "doc-1", path: "index", createdAt: "", templateId: "tpl-1" }),
            { status: 200 },
          );
        },
      },
    });
    const result = await client.lookupDocumentByPath("site-1", "index");
    expect(capturedUrl).toBe("https://ccr.example.com/api/sites/site-1/documents/by-path/index");
    expect(result?.templateId).toBe("tpl-1");
  });

  // A real 404 rather than a stubbed return value: the null has to come from the client itself.
  it("lookupDocumentByPath returns null when no document exists at the path", async () => {
    const client = new McpApiClient({
      ...baseConfig,
      fetcher: {
        fetch: async () =>
          new Response(JSON.stringify({ error: "Document not found at path" }), { status: 404 }),
      },
    });
    await expect(client.lookupDocumentByPath("site-1", "new-page")).resolves.toBeNull();
  });

  it("lookupDocumentByPath still throws when the lookup is refused", async () => {
    const client = new McpApiClient({
      ...baseConfig,
      fetcher: {
        fetch: async () =>
          new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
      },
    });
    await expect(client.lookupDocumentByPath("site-1", "index")).rejects.toThrow("Forbidden");
  });

  it("getTemplate hits the templates endpoint", async () => {
    let capturedUrl = "";
    const client = new McpApiClient({
      ...baseConfig,
      fetcher: {
        fetch: async (input) => {
          capturedUrl = String(input);
          return new Response(
            JSON.stringify({ id: "tpl-1", content: [], root: { props: {} } }),
            { status: 200 },
          );
        },
      },
    });
    const result = await client.getTemplate("site-1", "branch-1", "tpl-1");
    expect(capturedUrl).toBe("https://ccr.example.com/api/sites/site-1/branches/branch-1/templates/tpl-1");
    expect(result.id).toBe("tpl-1");
  });
});

describe("McpApiClient turn stop enforcement", () => {
  /** The X-Agent-Turn-Id the client actually puts on the wire for a given turn id. */
  async function sentTurnIdHeader(turnId?: string): Promise<string | undefined> {
    const seen: Record<string, string>[] = [];
    const client = new McpApiClient({
      baseUrl: "https://ccr.test",
      agentId: "agent-1",
      agentApiKey: "key",
      ...(turnId === undefined ? {} : { turnId }),
      fetcher: {
        fetch: (_url, init) => {
          seen.push(init?.headers as Record<string, string>);
          return Promise.resolve(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
        },
      },
    });

    await client.listDocuments("site-1", "branch-1");

    return seen[0]["X-Agent-Turn-Id"];
  }

  // Each output must be byte-identical to what CCR's normalizeTurnId records for the same
  // input — the 'turn\r\nabc' row pairs with stopped-turns.spec.ts — or a stop recorded
  // server-side stops matching what the agent sends. CR/LF cannot ride in a header value
  // at all, which is the injection row.
  it.each([
    ["sends the turn id", "turn-abc", "turn-abc"],
    ["neutralises a header-injection attempt", "turn\r\nX-Injected: 1", "turn  X-Injected: 1"],
    ["sanitizes to the value normalizeTurnId records", "turn\r\nabc", "turn  abc"],
    ["truncates past the shared 128-character cap", "t".repeat(200), "t".repeat(128)],
  ])("%s", async (_name, turnId, expected) => {
    expect(await sentTurnIdHeader(turnId)).toBe(expected);
  });

  it("omits the turn id when none was given", async () => {
    expect(await sentTurnIdHeader()).toBeUndefined();
  });

  it("recognises a stopped turn", async () => {
    const client = new McpApiClient({
      baseUrl: "https://ccr.test",
      agentId: "agent-1",
      agentApiKey: "key",
      turnId: "turn-abc",
      fetcher: {
        fetch: () => Promise.resolve(
          new Response(
            JSON.stringify({ error: "Turn stopped by a user", code: "agent_turn_stopped" }),
            { status: 409 },
          ),
        ),
      },
    });

    const err = await client.listDocuments("site-1", "branch-1").catch((e: unknown) => e);

    expect(isAgentTurnStopped(err)).toBe(true);
    expect((err as CcrApiError).status).toBe(409);
  });

  it("does not mistake another conflict for a stop", async () => {
    const client = new McpApiClient({
      baseUrl: "https://ccr.test",
      agentId: "agent-1",
      agentApiKey: "key",
      fetcher: {
        fetch: () => Promise.resolve(
          new Response(JSON.stringify({ error: "Region conflict" }), { status: 409 }),
        ),
      },
    });

    const err = await client.listDocuments("site-1", "branch-1").catch((e: unknown) => e);

    expect(isAgentTurnStopped(err)).toBe(false);
    expect((err as Error).message).toBe("Region conflict");
  });
});
