# Remote MCP Server with OAuth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Deploy the existing stdio MCP server as a remote Cloudflare Worker with Streamable HTTP transport, OAuth 2.0 authentication via Google, acting-user forwarding to the CSS backend for audit attribution, and Terraform infrastructure for sandbox/production deployment.

**Architecture:** A new Cloudflare Worker (`workers/mcp-server/`) serves the MCP protocol over Streamable HTTP. It reuses the existing tool definitions and API client from `examples/collaborative-state-mcp/` by copying and adapting for the Worker environment. The `@cloudflare/workers-oauth-provider` package handles the OAuth 2.0 Authorization Server role end-to-end -- discovery, authorize redirect, token exchange, token validation, and token revocation. It delegates user authentication to Google as the upstream IdP. The worker signs backend requests with an `aak_` agent API key (stored as a Worker secret), forwarding the authenticated user's identity via `X-Acting-User-Id` and `X-Acting-User-Email` headers. The CSS backend extracts these headers for agent principals and records both identities in audit events. Permission intersection ensures the acting user has the permissions the agent is exercising.

**Tech Stack:** TypeScript, Cloudflare Workers, `@cloudflare/workers-oauth-provider`, `@modelcontextprotocol/sdk` (Streamable HTTP), Vitest, Terraform (Cloudflare provider), Wrangler

---

## Decision Log

### D1: Separate Worker project, not embedded in existing worker

**Decision:** Create `workers/mcp-server/` as an independent Worker project with its own `wrangler.jsonc`, `package.json`, and `tsconfig.json`. It is NOT part of the parent `workers/` pnpm workspace -- it has its own `node_modules` and is deployed independently.

**Justification:** The proposal specifies "Separate worker on a subdomain" (Decision 2). The MCP server has fundamentally different routing (MCP protocol endpoints vs REST API), different auth model (OAuth 2.0 Authorization Server vs Bearer/API key validation), and different dependencies (`@cloudflare/workers-oauth-provider`). Embedding it in the existing worker would couple deploy cycles, bloat the worker bundle, and create routing conflicts. An independent project also lets Wrangler handle its own KV bindings and secrets without polluting the main worker config.

### D2: Share tool definitions and API client via file copy, not monorepo package

**Decision:** Copy `api-client.ts` and `tools.ts` from `examples/collaborative-state-mcp/src/` into `workers/mcp-server/src/shared/`, adapting them for the Worker environment (removing Node.js `process.env` dependencies, adding acting-user header support to the API client).

**Justification:** The proposal states "Shared tool definitions and API client code between local and remote servers" (Decision 5). A monorepo shared package would require restructuring the entire repo with workspace configs, which is out of scope. The existing `examples/` MCP server is a standalone Node.js project not part of the workers workspace. Copying and adapting is pragmatic -- the files are stable (well-defined API surface), and the Worker version needs material changes anyway (Worker `fetch` instead of Node `fetch`, acting-user headers, OAuth context). A future refactor into a shared package can be done later if needed.

### D3: Let `@cloudflare/workers-oauth-provider` own token lifecycle, not custom KV code

**Decision:** Use `@cloudflare/workers-oauth-provider`'s built-in `OAuthProvider` class for all OAuth concerns -- discovery, authorization, token exchange, token validation, and revocation. Do NOT build a custom `TokenStore` or manual KV token management.

**Justification:** The `@cloudflare/workers-oauth-provider` library is purpose-built for this exact pattern: a Cloudflare Worker acting as an OAuth Authorization Server that delegates to an upstream IdP. It handles token issuance, storage, validation, and revocation internally. Building custom token storage alongside the library would create two competing sources of truth and duplicate functionality the library already provides. The library uses KV natively for persistence, matching Decision 3 from the proposal. Our job is to implement the handler that the library calls during the OAuth flow -- specifically, to redirect users to Google and exchange Google auth codes for user identity.

### D4: Acting-user headers only trusted from agent principals

**Decision:** The CSS backend extracts `X-Acting-User-Id` and `X-Acting-User-Email` headers ONLY when the authenticated principal has `type: 'agent'`. Headers from user, service, or guest principals are silently ignored.

**Justification:** This is an explicit security requirement in the proposal (C3 security consideration). Without this gate, any authenticated user could forge acting-user headers to attribute their actions to someone else. Since only the MCP server (authenticated as an agent via `aak_` key) should forward these headers, the agent-type check is the correct trust boundary.

### D5: Permission intersection via `minRole` in the authorization pipeline

**Decision:** When `principal.actingUserEmail` is present, `getEffectiveRole()` in `workers/src/auth/authorization.ts` applies `minRole(agentEffectiveRole, actingUserSiteRole)` after computing the agent's effective role. The `minRole` function is added to `workers/src/auth/roles.ts` alongside the existing `maxRole` function, maintaining architectural consistency.

**Justification:** The proposal specifies "verify the acting user has at least the permissions the agent is exercising (defense in depth -- the agent's role is the ceiling, not a bypass)." Placing `minRole` in `roles.ts` next to `maxRole` keeps all role comparison logic in one module. Wiring the intersection into `getEffectiveRole()` means every authorization check in the system automatically respects acting-user constraints without modifying individual call sites.

**Acting-user role lookup path:** The acting user's site role is resolved by email. The `users` table has an `email` column (unique, indexed) but does NOT have a `provider_subject_id` column. The lookup joins `users.email` -> `users.id` -> `user_site_roles.user_id` to find the acting user's Pantheon site role. This mirrors the existing login flow where `users.email` is the entry point for resolving a user's database identity. If the acting user has never been added to the `users` allowlist, the query returns no rows and the effective role is `NO_ACCESS` -- the correct conservative behavior.

### D6: Acting-user identity stored in audit context, not new DB columns

**Decision:** Store `actingUserId` and `actingUserEmail` in the audit event's `context` JSON field rather than adding dedicated database columns.

**Justification:** The proposal suggests "Add `acting_user_id` and `acting_user_email` columns to relevant audit tables (or include in JSONB metadata)." The JSONB metadata approach is better because: (1) The audit system currently uses a `context: Record<string, unknown>` field that is the idiomatic place for variable contextual data. (2) Adding columns requires a database migration which affects all environments. (3) The acting-user data is only present for agent-initiated requests with forwarded identity -- it would be NULL for the vast majority of audit events. (4) JSONB context is queryable in PostgreSQL via `context->>'actingUserId'`.

### D7: `AuthenticatedPrincipal` extended with optional `actingUserId` and `actingUserEmail`

**Decision:** Add `actingUserId?: string` and `actingUserEmail?: string` to the `AuthenticatedPrincipal` interface in `workers/src/types.ts`.

**Justification:** These fields need to flow through the request lifecycle from header extraction to audit emission. The `AuthenticatedPrincipal` is the standard carrier of identity context in this codebase, passed through middleware and into service/audit layers. Adding optional fields to the existing interface is less invasive than creating a parallel "enhanced principal" type, and follows the pattern established by `dbUserId`, `providerSubjectId`, and `siteId` -- all optional identity context added for specific auth flows.

### D8: Rate limiting via Cloudflare built-in, configured in wrangler

**Decision:** Use Cloudflare's built-in rate limiting rules (100 req/min/user) configured in `wrangler.jsonc`, not custom code.

**Justification:** The proposal specifies "Rate limiting at 100 tool calls/min/user. Cloudflare built-in rate limiting." Custom rate limiting would require Durable Objects or external state. Cloudflare's edge rate limiting is more efficient, handles 429 responses with `Retry-After` automatically, and requires no application code.

### D9: Register all 11 tool definitions including presence tools

**Decision:** The remote MCP server registers all 11 tool definitions from `tools.ts`, including the 2 presence tools (`get_branch_presence`, `get_document_presence`).

**Justification:** The existing stdio MCP server (`examples/collaborative-state-mcp/src/index.ts`) only registers 9 of the 11 defined tools -- the 2 presence tools (`get_branch_presence`, `get_document_presence`) are defined in `tools.ts` with handlers but were never wired into `index.ts`. The remote MCP server should register all 11, since the tool definitions and handlers already exist and are tested. This also surfaces presence capabilities to remote MCP users.

**Deviation from proposal:** The proposal's C1 says "Verify all 9 tools work via MCP Inspector over HTTP." We intentionally register all 11 because the 2 presence tools are already implemented and tested in `tools.ts` -- they were simply omitted from the stdio server's `index.ts` registration. There is no reason to carry forward that omission.

---

## Task 1: Scaffold the MCP Worker project

**Files:**
- Create: `workers/mcp-server/package.json`
- Create: `workers/mcp-server/tsconfig.json`
- Create: `workers/mcp-server/wrangler.jsonc`
- Create: `workers/mcp-server/vitest.config.ts`
- Create: `workers/mcp-server/eslint.config.js`
- Create: `workers/mcp-server/.dev.vars.example`

**Step 1: Create package.json**

```json
{
  "name": "css-mcp-server",
  "version": "0.1.0",
  "description": "Remote MCP server for Collaborative State System with OAuth 2.0 authentication",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:sbx1": "wrangler deploy --env sbx1",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "lint:fix": "eslint src tests --fix",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cloudflare/workers-oauth-provider": "^0.3.0",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250320.0",
    "@eslint/js": "^9.39.3",
    "eslint": "^9.39.3",
    "globals": "^15.15.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.56.1",
    "vitest": "^2.1.9",
    "wrangler": "^4.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create wrangler.jsonc**

Model the config on the existing `workers/wrangler.jsonc`. Key differences: separate worker name, port 8788 for local dev, MCP_OAUTH_KV binding, no Durable Objects, no queues, no Hyperdrive.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/schemas/config.json",

  "name": "css-mcp-server",
  "main": "src/index.ts",

  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],

  // KV namespace for OAuth token storage (used by @cloudflare/workers-oauth-provider)
  "kv_namespaces": [
    { "binding": "MCP_OAUTH_KV", "id": "local-mcp-oauth-kv", "preview_id": "local-mcp-oauth-kv-preview" }
  ],

  // Non-secret environment variables
  "vars": {
    "ENVIRONMENT": "local",
    "CSS_BACKEND_URL": "http://localhost:8787",
    "MCP_SERVER_NAME": "collaborative-state-mcp",
    "MCP_SERVER_VERSION": "0.1.0"
  },

  // Local development
  "dev": {
    "port": 8788,
    "local_protocol": "http",
    "ip": "0.0.0.0"
  },

  // Environment overrides
  "env": {
    "sbx1": {
      "name": "css-mcp-server-sbx1",
      "vars": {
        "ENVIRONMENT": "sbx1",
        "CSS_BACKEND_URL": "https://collaborative-state-worker-sbx1.chris-801.workers.dev",
        "MCP_SERVER_NAME": "collaborative-state-mcp",
        "MCP_SERVER_VERSION": "0.1.0"
      },
      "kv_namespaces": [
        { "binding": "MCP_OAUTH_KV", "id": "REPLACE_WITH_SBX1_MCP_OAUTH_KV_ID" }
      ]
    },
    "production": {
      "name": "css-mcp-server-prod",
      "vars": {
        "ENVIRONMENT": "production",
        "CSS_BACKEND_URL": "https://collaborative-state-worker-prod.pantheon.workers.dev",
        "MCP_SERVER_NAME": "collaborative-state-mcp",
        "MCP_SERVER_VERSION": "0.1.0"
      },
      "kv_namespaces": [
        { "binding": "MCP_OAUTH_KV", "id": "REPLACE_WITH_PROD_MCP_OAUTH_KV_ID" }
      ]
    }
  }
}
```

**Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
```

**Step 5: Create eslint.config.js**

Copy from `workers/eslint.config.js` and adjust paths. The existing config pattern uses `@eslint/js` and `typescript-eslint` with strict type-checked and stylistic configs.

**Step 6: Create .dev.vars.example**

```
# MCP Server Development Secrets
# Copy to .dev.vars and fill in values

# Agent credentials (for authenticating to CSS backend)
AGENT_API_KEY=aak_your-agent-key-here
AGENT_ID=your-agent-uuid-here

# Google OAuth (for user authentication)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Cookie encryption key (for OAuth flow)
COOKIE_ENCRYPTION_KEY=generate-a-random-32-byte-hex-string
```

**Step 7: Install dependencies**

**Workspace note:** This project is NOT part of the parent `workers/` pnpm workspace. It has its own `package.json` and `node_modules`. Verify there is no `pnpm-workspace.yaml` in `workers/` that would accidentally include `mcp-server/`. If one exists and uses a glob like `packages/*` or `*/`, it should NOT match `mcp-server/`. The MCP server manages its own dependencies independently.

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm install`

**Step 8: Verify typecheck passes**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm typecheck`
Expected: Pass (no source files yet, but config is valid)

**Step 9: Commit**

```bash
git add workers/mcp-server/package.json workers/mcp-server/tsconfig.json workers/mcp-server/wrangler.jsonc workers/mcp-server/vitest.config.ts workers/mcp-server/eslint.config.js workers/mcp-server/.dev.vars.example
git commit -m "chore: scaffold MCP Worker project with Wrangler config"
```

---

## Task 2: Port shared tool definitions and API client

**Files:**
- Create: `workers/mcp-server/src/shared/api-client.ts`
- Create: `workers/mcp-server/src/shared/tools.ts`
- Create: `workers/mcp-server/src/shared/types.ts`
- Test: `workers/mcp-server/tests/shared/api-client.spec.ts`
- Test: `workers/mcp-server/tests/shared/tools.spec.ts`

**Step 1: Write the failing test for the API client**

Create `workers/mcp-server/tests/shared/api-client.spec.ts`. Tests should verify:

1. Constructor requires `baseUrl`, `agentId`, `agentApiKey`
2. `getHeaders()` includes `X-API-Key`, `X-Actor-Type: agent`, `X-Actor-Id`
3. Acting-user headers: when `actingUser` is set, requests include `X-Acting-User-Id` and `X-Acting-User-Email`
4. Acting-user headers: when `actingUser` is NOT set, these headers are absent
5. All API methods (`listSites`, `listBranches`, `listDocuments`, `getDocument`, `canAgentEdit`, `startAgentEdit`, `applyEdits`, `completeAgentEdit`, `abortAgentEdit`, `getBranchPresence`, `getDocumentPresence`) call correct URLs with correct methods
6. Error handling: non-200 responses throw with error message

Reference `examples/collaborative-state-mcp/tests/api-client.spec.ts` for patterns. The key difference is the new `actingUser?: { id: string; email: string }` optional parameter on the constructor.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('McpApiClient', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const defaultConfig = {
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-uuid-1',
    agentApiKey: 'aak_test-key',
  };

  function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
    return { ok, status, json: () => Promise.resolve(data) } as Response;
  }

  it('should include acting-user headers when actingUser is set', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({
      ...defaultConfig,
      actingUser: { id: 'user-123', email: 'user@example.com' },
    });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
    await client.listSites();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['X-Acting-User-Id']).toBe('user-123');
    expect(options.headers['X-Acting-User-Email']).toBe('user@example.com');
  });

  it('should NOT include acting-user headers when actingUser is absent', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient(defaultConfig);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
    await client.listSites();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['X-Acting-User-Id']).toBeUndefined();
    expect(options.headers['X-Acting-User-Email']).toBeUndefined();
  });

  // ... additional tests for all API methods, error handling, URL construction
});
```

**Step 2: Write the failing test for tool handlers**

Create `workers/mcp-server/tests/shared/tools.spec.ts`. Mirror the structure from `examples/collaborative-state-mcp/tests/tools.spec.ts`. The tests are the same since tool handler logic is identical -- only the transport and API client class name differ.

**Step 3: Run tests to verify they fail**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test`
Expected: FAIL (modules don't exist yet)

**Step 4: Commit tests**

```bash
git add workers/mcp-server/tests/
git commit -m "test: add failing tests for MCP Worker shared API client and tools"
```

**Step 5: Create the shared types**

Create `workers/mcp-server/src/shared/types.ts` with the `ActingUser` interface and re-export relevant types:

```typescript
export interface ActingUser {
  id: string;
  email: string;
}

export interface McpApiClientConfig {
  baseUrl: string;
  agentId: string;
  agentApiKey: string;
  actingUser?: ActingUser;
}
```

**Step 6: Create the McpApiClient**

Create `workers/mcp-server/src/shared/api-client.ts`. Port from `examples/collaborative-state-mcp/src/api-client.ts` with these changes:
- Class renamed to `McpApiClient` to avoid collision with the existing `ApiClient`
- Constructor accepts optional `actingUser: ActingUser`
- `getHeaders()` conditionally includes `X-Acting-User-Id` and `X-Acting-User-Email`
- Uses Worker-native `fetch` (no Node.js imports)

**Step 7: Create tool definitions**

Create `workers/mcp-server/src/shared/tools.ts`. Copy from `examples/collaborative-state-mcp/src/tools.ts` with one change: use `McpApiClient` instead of `ApiClient`. All 11 tools should be present (definitions and handlers).

**Step 8: Run tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test`
Expected: PASS

**Step 9: Lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm lint`
Expected: 0 errors

**Step 10: Commit**

```bash
git add workers/mcp-server/src/shared/
git commit -m "feat: port API client and tool definitions for MCP Worker with acting-user support"
```

---

## Task 3: Implement Worker entry point with health check and MCP transport (C1)

**Files:**
- Create: `workers/mcp-server/src/index.ts`
- Create: `workers/mcp-server/src/mcp-handler.ts`
- Create: `workers/mcp-server/src/types.ts`
- Test: `workers/mcp-server/tests/mcp-handler.spec.ts`
- Test: `workers/mcp-server/tests/health.spec.ts`

This task creates the unauthenticated MCP server -- all requests are accepted. Authentication is layered on in Task 4.

**Step 1: Write the failing test for the MCP handler**

Create `workers/mcp-server/tests/mcp-handler.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MCP Handler', () => {
  describe('createMcpServer', () => {
    it('should create an MCP server instance', async () => {
      const { createMcpServer } = await import('../src/mcp-handler.js');
      const server = createMcpServer({
        baseUrl: 'http://localhost:8787',
        agentId: 'agent-1',
        agentApiKey: 'aak_test',
        serverName: 'test-mcp',
        serverVersion: '0.1.0',
      });
      expect(server).toBeDefined();
    });
  });

  describe('tool registration', () => {
    it('should register all 11 tools', async () => {
      // Create a mock McpServer that records registerTool calls
      // Verify all 11 tool names are registered:
      // list_sites, list_branches, list_documents, get_document,
      // check_edit_permission, start_edit_session, apply_document_edits,
      // complete_edit_session, abort_edit_session,
      // get_branch_presence, get_document_presence
    });
  });
});
```

**Step 2: Write the failing test for health endpoint**

Create `workers/mcp-server/tests/health.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Health endpoint', () => {
  it('should return 200 with status healthy', async () => {
    const { handleHealthCheck } = await import('../src/index.js');
    const response = handleHealthCheck('local');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('css-mcp-server');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test`
Expected: FAIL

**Step 4: Commit tests**

```bash
git add workers/mcp-server/tests/mcp-handler.spec.ts workers/mcp-server/tests/health.spec.ts
git commit -m "test: add failing tests for MCP handler and health endpoint"
```

**Step 5: Create the Worker types**

Create `workers/mcp-server/src/types.ts`:

```typescript
export interface Env {
  // Non-secret env vars
  ENVIRONMENT: string;
  CSS_BACKEND_URL: string;
  MCP_SERVER_NAME: string;
  MCP_SERVER_VERSION: string;

  // Secrets
  AGENT_API_KEY: string;
  AGENT_ID: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;

  // KV binding (used by @cloudflare/workers-oauth-provider)
  MCP_OAUTH_KV: KVNamespace;
}
```

**Step 6: Create the MCP handler**

Create `workers/mcp-server/src/mcp-handler.ts`. This module:
1. Creates an `McpServer` instance from `@modelcontextprotocol/sdk`
2. Creates an `McpApiClient` with the provided config (including optional `actingUser`)
3. Creates tool handlers via `createToolHandlers()`
4. Registers ALL 11 tools with their schemas and handlers (matching the pattern from `examples/collaborative-state-mcp/src/index.ts` lines 49-183, but also including `get_branch_presence` and `get_document_presence` which the stdio server omitted)
5. Exports a `createMcpServer()` factory function

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpApiClient } from './shared/api-client.js';
import { createToolHandlers, getToolDefinitions, schemas } from './shared/tools.js';
import type { ActingUser } from './shared/types.js';

export interface McpHandlerConfig {
  baseUrl: string;
  agentId: string;
  agentApiKey: string;
  serverName: string;
  serverVersion: string;
  actingUser?: ActingUser;
}

export function createMcpServer(config: McpHandlerConfig): McpServer {
  const apiClient = new McpApiClient({
    baseUrl: config.baseUrl,
    agentId: config.agentId,
    agentApiKey: config.agentApiKey,
    actingUser: config.actingUser,
  });

  const handlers = createToolHandlers(apiClient);
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  const toolDefinitions = getToolDefinitions();

  // Register all 11 tools following the exact pattern from
  // examples/collaborative-state-mcp/src/index.ts
  // Each tool: server.registerTool(name, { description, inputSchema }, handler)
  // IMPORTANT: include get_branch_presence and get_document_presence
  // which the stdio server omitted

  return server;
}
```

**Step 7: Create the Worker entry point (unauthenticated for C1)**

Create `workers/mcp-server/src/index.ts`. In this phase, the MCP endpoint is unauthenticated. The `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js` handles the HTTP-to-MCP bridge.

**Important Cloudflare Workers note:** Each incoming request to a Worker starts a fresh execution context -- there is no persistent process. This means a new `McpServer` and `StreamableHTTPServerTransport` are created per request. This is the idiomatic Cloudflare Workers pattern and works correctly because each MCP JSON-RPC call is a self-contained POST request. The `sessionIdGenerator: undefined` option puts the transport in stateless mode, matching this per-request lifecycle.

```typescript
import type { Env } from './types.js';
import { createMcpServer } from './mcp-handler.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function handleHealthCheck(environment: string): Response {
  return new Response(JSON.stringify({
    status: 'healthy',
    service: 'css-mcp-server',
    environment,
    timestamp: new Date().toISOString(),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check (unauthenticated)
    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealthCheck(env.ENVIRONMENT);
    }

    // MCP endpoint - unauthenticated in C1, OAuth wraps this in Task 4
    if (url.pathname === '/mcp') {
      const server = createMcpServer({
        baseUrl: env.CSS_BACKEND_URL,
        agentId: env.AGENT_ID,
        agentApiKey: env.AGENT_API_KEY,
        serverName: env.MCP_SERVER_NAME,
        serverVersion: env.MCP_SERVER_VERSION,
      });

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      return await transport.handleRequest(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

**Step 8: Run tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test`
Expected: PASS

**Step 9: Lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm lint`
Expected: 0 errors

**Step 10: Commit**

```bash
git add workers/mcp-server/src/
git commit -m "feat(C1): implement MCP Worker with Streamable HTTP transport and health check"
```

---

## Task 4: Implement OAuth 2.0 via `@cloudflare/workers-oauth-provider` (C2)

**Files:**
- Create: `workers/mcp-server/src/auth/google-handler.ts`
- Modify: `workers/mcp-server/src/index.ts`
- Test: `workers/mcp-server/tests/auth/google-handler.spec.ts`
- Test: `workers/mcp-server/tests/auth/oauth-integration.spec.ts`

This task integrates `@cloudflare/workers-oauth-provider` to wrap the MCP endpoint with OAuth 2.0 authentication. The library handles the heavy lifting: discovery endpoint, token issuance/validation/revocation, and KV storage. We implement the handler that the library calls during the OAuth flow to delegate user authentication to Google.

**IMPORTANT: Consult the actual `@cloudflare/workers-oauth-provider` API.** After `pnpm install` in Task 1, read the library's type definitions (`node_modules/@cloudflare/workers-oauth-provider/dist/index.d.ts`) and any README in its package directory. The code below describes functional intent, not exact API shapes. Use the library's actual API.

**Known API pattern (from Cloudflare's remote MCP auth template):** The `@cloudflare/workers-oauth-provider` library exports an `OAuthProvider` class that wraps the Worker's default export. It intercepts OAuth paths and passes authenticated requests through to a downstream handler. The typical pattern is:

```typescript
import OAuthProvider from '@cloudflare/workers-oauth-provider';

export default new OAuthProvider({
  apiRoute: '/mcp',           // The route to protect
  // apiHandler: ...,         // The downstream handler for authenticated requests
  // defaultHandler: ...,     // Handler for non-API routes (health, etc.)
  // authorizeEndpoint: ...,  // Custom authorize handler (redirect to Google)
  // tokenEndpoint: ...,      // May be handled automatically
  // clientRegistrationEndpoint: ..., // Dynamic client registration
});
```

The library provides the authenticated user's identity (stored as `props` on the token) to the downstream handler. Read the library's `AuthRequest`, `OAuthHelpers`, and related types to determine:
- How `props` are set during authorization completion
- How `props` are accessed in the downstream API handler
- The exact KV binding name the library expects (it may use a specific binding name like `OAUTH_KV` rather than a configurable one)
- How dynamic client registration works (MCP clients register themselves)

**Cloudflare's MCP auth examples** (search for `cloudflare/ai/demos/remote-mcp-server` on GitHub or `@cloudflare/workers-oauth-provider` examples) show the idiomatic pattern. The executing agent MUST read these to determine exact API shapes before writing code.

**Key architectural point:** The `@cloudflare/workers-oauth-provider` library works by wrapping the Worker's entire `fetch` handler. It intercepts OAuth-related paths (`/.well-known/oauth-authorization-server`, `/authorize`, `/token`, `/revoke`) and passes through all other requests to the downstream handler (our MCP server) -- but only after validating the Bearer token. The authenticated user's identity (from the token's `claims` or `props`) is available in the downstream handler's context.

**Step 1: Write the failing test for the Google auth handler**

Create `workers/mcp-server/tests/auth/google-handler.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('GoogleOAuthHandler', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe('getGoogleAuthorizationUrl', () => {
    it('should construct a Google OAuth authorization URL with correct params', async () => {
      const { getGoogleAuthorizationUrl } = await import('../../src/auth/google-handler.js');
      const url = getGoogleAuthorizationUrl({
        clientId: 'test-client-id',
        redirectUri: 'http://localhost:8788/callback',
        state: 'state-123',
        scope: 'openid email profile',
      });
      expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('state=state-123');
      expect(url).toContain('response_type=code');
    });
  });

  describe('exchangeGoogleCode', () => {
    it('should exchange an auth code for Google tokens and user info', async () => {
      const { exchangeGoogleCode } = await import('../../src/auth/google-handler.js');
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'google-access-token',
          id_token: 'eyJhbGciOiJSUzI1NiJ9.' +
            btoa(JSON.stringify({ sub: '12345', email: 'user@example.com', name: 'Test User' })) +
            '.fakesig',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await exchangeGoogleCode({
        code: 'auth-code-123',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:8788/callback',
      });
      expect(result.accessToken).toBe('google-access-token');
      expect(result.user.sub).toBe('12345');
      expect(result.user.email).toBe('user@example.com');
    });
  });

  describe('decodeIdTokenClaims', () => {
    it('should decode user info from ID token payload', async () => {
      const { decodeIdTokenClaims } = await import('../../src/auth/google-handler.js');
      const payload = btoa(JSON.stringify({
        sub: '1234567890',
        email: 'user@example.com',
        name: 'Test User',
        email_verified: true,
      }));
      const mockIdToken = `eyJhbGciOiJSUzI1NiJ9.${payload}.fakesig`;
      const claims = decodeIdTokenClaims(mockIdToken);
      expect(claims.sub).toBe('1234567890');
      expect(claims.email).toBe('user@example.com');
      expect(claims.name).toBe('Test User');
    });
  });
});
```

**Step 2: Write the failing test for the OAuth integration**

Create `workers/mcp-server/tests/auth/oauth-integration.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('OAuth Integration', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe('worker with OAuthProvider wrapper', () => {
    it('GET /health should be accessible without auth', async () => {
      // Health endpoint is outside the OAuthProvider wrapper
      // Test that it returns 200 without any Bearer token
    });

    it('POST /mcp without auth should return 401', async () => {
      // MCP endpoint is wrapped by OAuthProvider
      // Requests without a valid Bearer token should be rejected
    });

    it('GET /.well-known/oauth-authorization-server should return OAuth metadata', async () => {
      // OAuthProvider handles this endpoint automatically
      // Should include issuer, authorization_endpoint, token_endpoint, etc.
    });

    it('should pass authenticated user claims to the MCP handler', async () => {
      // When a valid Bearer token is present, the OAuthProvider validates it
      // and makes the user's claims available to the downstream MCP handler.
      // The MCP handler should create an McpApiClient with actingUser set
      // from those claims.
    });
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test`
Expected: FAIL

**Step 4: Commit tests**

```bash
git add workers/mcp-server/tests/auth/
git commit -m "test: add failing tests for Google OAuth handler and OAuth integration"
```

**Step 5: Implement the Google auth handler**

Create `workers/mcp-server/src/auth/google-handler.ts`. This module provides:
- `getGoogleAuthorizationUrl()` -- builds the Google OAuth authorize URL
- `exchangeGoogleCode()` -- exchanges an auth code for tokens and user info
- `decodeIdTokenClaims()` -- decodes the JWT payload of a Google ID token (no signature validation needed since we received it directly from Google's token endpoint over HTTPS)
- The handler class/functions that `@cloudflare/workers-oauth-provider` calls during the OAuth flow

The handler implementation must conform to whatever interface `@cloudflare/workers-oauth-provider` expects. Read the library's type definitions to determine the exact interface. The functional requirements are:

1. **On authorize:** Redirect the user to Google's authorization page with `client_id`, `redirect_uri` (pointing to our `/callback`), `scope=openid email profile`, `response_type=code`, and `state` (preserving the OAuth request info so we can resume after Google redirects back).

2. **On callback from Google:** Extract the auth code and state from query params. Exchange the code for Google tokens via `exchangeGoogleCode()`. Decode the ID token to get user claims (`sub`, `email`, `name`). Call the library's completion function (e.g., `completeAuthorization()`) to issue MCP tokens with user claims embedded. Token TTLs: access=3600s (1hr), refresh=2592000s (30d) per Decision 3.

**Step 6: Update the Worker entry point to use OAuthProvider**

Modify `workers/mcp-server/src/index.ts` to wrap the MCP handler with `OAuthProvider`. The functional requirements:

1. `GET /health` remains unauthenticated, handled BEFORE the OAuthProvider wrapper
2. All other paths go through OAuthProvider, which:
   - Handles `/.well-known/oauth-authorization-server`, `/authorize`, `/token`, `/revoke` automatically
   - Validates Bearer tokens on `/mcp` requests
   - Passes validated user claims/props to the downstream handler
3. The downstream handler (for `/mcp`) receives user identity from the token, creates an `McpApiClient` with `actingUser` set from those claims, and processes the MCP request

Read `@cloudflare/workers-oauth-provider`'s actual API to determine:
- How to instantiate `OAuthProvider` (constructor params, KV binding name)
- How the downstream handler receives authenticated user claims
- How `/callback` is routed (library-managed or custom route)
- Whether the library expects specific KV binding names

**Step 7: Run tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test`
Expected: PASS

**Step 8: Lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm lint`
Expected: 0 errors

**Step 9: Commit**

```bash
git add workers/mcp-server/src/auth/ workers/mcp-server/src/index.ts
git commit -m "feat(C2): implement OAuth 2.0 with Google IdP via @cloudflare/workers-oauth-provider"
```

---

## Task 5: Acting-user extraction, permission intersection, and audit forwarding in CSS backend (C3)

**Files:**
- Modify: `workers/src/types.ts` (add `actingUserId`, `actingUserEmail` to `AuthenticatedPrincipal`)
- Create: `workers/src/auth/acting-user.ts`
- Modify: `workers/src/auth/roles.ts` (add `minRole` next to existing `maxRole`)
- Modify: `workers/src/auth/authorization.ts` (wire permission intersection into `getEffectiveRole`)
- Modify: `workers/src/index.ts` (extract acting-user after auth, attach to principal)
- Test: `workers/tests/auth/acting-user.spec.ts`
- Test: `workers/tests/auth/permission-intersection.spec.ts`
- Test: `workers/tests/audit/acting-user-audit.spec.ts`

This task is the complete C3 implementation in the CSS backend. It covers three concerns: (1) extracting acting-user headers from agent requests, (2) intersecting the acting user's permissions with the agent's permissions in the authorization pipeline, and (3) verifying that the existing audit `context` passthrough works for acting-user data.

**Step 1: Write failing tests for acting-user header extraction**

Create `workers/tests/auth/acting-user.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Acting-User Extraction', () => {
  describe('extractActingUser', () => {
    it('should extract acting-user headers when principal is agent type', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user.js');
      const headers = new Headers({
        'X-Acting-User-Id': 'user-uuid-123',
        'X-Acting-User-Email': 'user@example.com',
      });
      const principal = { type: 'agent' as const, id: 'agent-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toEqual({
        actingUserId: 'user-uuid-123',
        actingUserEmail: 'user@example.com',
      });
    });

    it('should return null when principal is user type (ignore headers)', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user.js');
      const headers = new Headers({
        'X-Acting-User-Id': 'spoofed-user-id',
        'X-Acting-User-Email': 'spoofed@example.com',
      });
      const principal = { type: 'user' as const, id: 'user-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });

    it('should return null when principal is service type', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user.js');
      const headers = new Headers({
        'X-Acting-User-Id': 'spoofed-user-id',
        'X-Acting-User-Email': 'spoofed@example.com',
      });
      const principal = { type: 'service' as const, id: 'service-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });

    it('should return null when agent has no acting-user headers', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user.js');
      const headers = new Headers();
      const principal = { type: 'agent' as const, id: 'agent-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });

    it('should return null when only one of the two required headers is present', async () => {
      const { extractActingUser } = await import('../../src/auth/acting-user.js');
      const headers = new Headers({
        'X-Acting-User-Id': 'user-uuid-123',
        // Missing X-Acting-User-Email
      });
      const principal = { type: 'agent' as const, id: 'agent-1' };

      const result = extractActingUser(headers, principal);
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Write failing tests for permission intersection**

Create `workers/tests/auth/permission-intersection.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Permission Intersection', () => {
  describe('minRole', () => {
    it('should return the lower role when user has lower role than agent', async () => {
      const { minRole } = await import('../../src/auth/roles.js');
      expect(minRole('EDITOR', 'VIEWER')).toBe('VIEWER');
    });

    it('should return the agent role when user has higher role', async () => {
      const { minRole } = await import('../../src/auth/roles.js');
      expect(minRole('EDITOR', 'ADMIN')).toBe('EDITOR');
    });

    it('should return NO_ACCESS when either role is NO_ACCESS', async () => {
      const { minRole } = await import('../../src/auth/roles.js');
      expect(minRole('EDITOR', 'NO_ACCESS')).toBe('NO_ACCESS');
      expect(minRole('NO_ACCESS', 'ADMIN')).toBe('NO_ACCESS');
    });

    it('should return the same role when both are equal', async () => {
      const { minRole } = await import('../../src/auth/roles.js');
      expect(minRole('EDITOR', 'EDITOR')).toBe('EDITOR');
    });
  });
});
```

**Step 3: Write the audit context forwarding verification test**

Create `workers/tests/audit/acting-user-audit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createAuditEvent } from '../../src/audit/emitter.js';

describe('Acting-User Audit', () => {
  it('should include actingUserId and actingUserEmail in audit context when provided', () => {
    const event = createAuditEvent({
      action: 'document.update',
      actor: { id: 'agent-1', type: 'agent' },
      resource: { type: 'document', id: 'doc-1', siteId: 'site-1' },
      context: {
        actingUserId: 'user-uuid-123',
        actingUserEmail: 'user@example.com',
        editSessionId: 'session-abc',
      },
      success: true,
    });

    expect(event.context.actingUserId).toBe('user-uuid-123');
    expect(event.context.actingUserEmail).toBe('user@example.com');
  });

  it('should work without acting-user fields (backwards compatible)', () => {
    const event = createAuditEvent({
      action: 'document.update',
      actor: { id: 'agent-1', type: 'agent' },
      resource: { type: 'document', id: 'doc-1', siteId: 'site-1' },
      context: { editSessionId: 'session-abc' },
      success: true,
    });

    expect(event.context.actingUserId).toBeUndefined();
    expect(event.context.actingUserEmail).toBeUndefined();
  });
});
```

**Step 4: Run tests to verify they fail** (acting-user tests will fail; audit test should already pass since it uses existing `context` passthrough)

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers && pnpm test -- tests/auth/acting-user.spec.ts tests/auth/permission-intersection.spec.ts tests/audit/acting-user-audit.spec.ts`
Expected: acting-user and permission-intersection tests FAIL, audit test PASS

**Step 5: Commit tests**

```bash
git add workers/tests/auth/acting-user.spec.ts workers/tests/auth/permission-intersection.spec.ts workers/tests/audit/acting-user-audit.spec.ts
git commit -m "test: add failing tests for acting-user extraction, permission intersection, and audit forwarding"
```

**Step 6: Extend AuthenticatedPrincipal type**

Add to `workers/src/types.ts` in the `AuthenticatedPrincipal` interface (after `systemRole`, before the closing `}`):

```typescript
  /** Acting user ID forwarded from MCP server (agent principals only) */
  actingUserId?: string;
  /** Acting user email forwarded from MCP server (agent principals only) */
  actingUserEmail?: string;
```

**Step 7: Create the acting-user extraction module**

Create `workers/src/auth/acting-user.ts`:

```typescript
/**
 * Acting-user header extraction for agent principals.
 *
 * When the MCP server (authenticated as an agent) forwards requests to the CSS backend,
 * it includes X-Acting-User-Id and X-Acting-User-Email headers identifying the human
 * who initiated the action. This module extracts those headers, but ONLY trusts them
 * from agent principals (security: prevents header spoofing by regular users).
 */

export interface ActingUserInfo {
  actingUserId: string;
  actingUserEmail: string;
}

/**
 * Extract acting-user identity from request headers.
 * ONLY trusts these headers when the authenticated principal is type 'agent'.
 * Returns null for all other principal types (security: prevents header spoofing).
 */
export function extractActingUser(
  headers: Headers,
  principal: { type: string },
): ActingUserInfo | null {
  if (principal.type !== 'agent') {
    return null;
  }

  const userId = headers.get('X-Acting-User-Id');
  const userEmail = headers.get('X-Acting-User-Email');

  if (!userId || !userEmail) {
    return null;
  }

  return { actingUserId: userId, actingUserEmail: userEmail };
}
```

**Step 8: Add `minRole` to `workers/src/auth/roles.ts`**

Add the `minRole` function next to the existing `maxRole` function in `workers/src/auth/roles.ts`. This maintains architectural consistency -- all role comparison logic lives in one module.

```typescript
/**
 * Returns the lower of two roles based on privilege level.
 * Used for permission intersection when an agent acts on behalf of a user --
 * the effective role is min(agentRole, userRole) to prevent privilege escalation.
 *
 * @param a - First role name
 * @param b - Second role name
 * @returns The role with lower privileges
 */
export function minRole(a: RoleName, b: RoleName): RoleName {
  const indexA = ROLE_ORDER.indexOf(a);
  const indexB = ROLE_ORDER.indexOf(b);
  return indexA < indexB ? a : b;
}
```

**Step 9: Wire permission intersection into `getEffectiveRole` in `workers/src/auth/authorization.ts`**

First, update the import from `./roles` to include `minRole`:
```typescript
import { ROLES, mapPantheonRole, mapAgentRole, maxRole, minRole } from './roles';
```

Then, in `getEffectiveRole()`, find the existing return statement after `const effectiveRoleName = maxRole(baselineRoleName, grantRoleName);` (currently at line ~244). Replace the simple return with the permission intersection logic:

```typescript
  // Step 3: Effective role is the higher of the two
  const effectiveRoleName = maxRole(baselineRoleName, grantRoleName);

  // Step 4: Permission intersection for acting-user requests
  // When an agent acts on behalf of a user, the effective role is
  // min(agentEffectiveRole, actingUserSiteRole) to prevent privilege escalation.
  let finalRoleName = effectiveRoleName;
  if (principal.type === 'agent' && principal.actingUserEmail) {
    const actingUserSiteRole = await getActingUserSiteRole(principal.actingUserEmail, siteId);
    finalRoleName = minRole(effectiveRoleName, actingUserSiteRole);
  }

  return {
    role: ROLES[finalRoleName],
    roleName: finalRoleName,
  };
```

This replaces the existing return block (lines ~246-249) which currently returns `{ role: ROLES[effectiveRoleName], roleName: effectiveRoleName }`.

The `getActingUserSiteRole` helper queries the database for the acting user's site role. It looks up the user by their email (from `X-Acting-User-Email`), joins through the `users` table to get their database `id`, then finds their site role in `user_site_roles`. If the user is not found or has no role on the site, it returns `NO_ACCESS`.

```typescript
/**
 * Look up an acting user's effective site role from the database.
 * Used for permission intersection when an agent acts on behalf of a user.
 *
 * The actingUserEmail comes from the `X-Acting-User-Email` header,
 * which the MCP server populates from the Google OAuth ID token's
 * `email` claim.
 *
 * Lookup path: users.email -> users.id -> user_site_roles.user_id
 *
 * The `users` table has `email` (unique, indexed via idx_users_email)
 * but does NOT have a `provider_subject_id` column. The `user_id`
 * column in `user_site_roles` stores the `users.id` database UUID
 * (set during the allowlist/login flow in index.ts).
 *
 * If the user has never been added to the `users` allowlist, the
 * query returns no rows and the effective role is NO_ACCESS -- the
 * correct conservative behavior (no record = no access).
 */
async function getActingUserSiteRole(actingUserEmail: string, siteId: string): Promise<RoleName> {
  const result = await query<{ role: PantheonRole }>(
    `SELECT usr.role FROM app.user_site_roles usr
     JOIN app.users u ON u.id::text = usr.user_id
     WHERE u.email = $1 AND usr.site_id = $2
     LIMIT 1`,
    [actingUserEmail.toLowerCase(), siteId],
  );

  if (result.rows.length === 0) {
    return 'NO_ACCESS';
  }

  return mapPantheonRole(result.rows[0].role);
}
```

**Schema note:** The `users` table (migration 017) has columns: `id` (UUID PK), `email` (TEXT UNIQUE), `principal_id` (TEXT, set on first login), but no `provider_subject_id` column. The `user_site_roles` table (migration 014) has `user_id` (TEXT) which stores an external user ID. In the existing `getSiteRole()` function, this is looked up via `principal.dbUserId ?? principal.id`. For acting-user lookups, we use `email` as the entry point because: (1) it is always available from the Google OAuth ID token, (2) it is the primary identifier in the `users` allowlist, and (3) it avoids needing to construct a UUIDv5 from the Google sub claim in the authorization layer. The `u.id::text = usr.user_id` cast handles the UUID-to-TEXT comparison between `users.id` and `user_site_roles.user_id`.

**Step 10: Wire acting-user extraction into the main worker `index.ts`**

In `workers/src/index.ts`, find the section after `const principal = await authenticate(request, env);` and the null check that follows it (`if (!principal) { return ... 401 ... }`). Immediately after the 401 response block closes (before the service principal scope enforcement section that starts with `if (principal.type === 'service')`), add the acting-user extraction:

Add the import at the top of the file:
```typescript
import { extractActingUser } from './auth/acting-user';
```

Add the extraction after the auth null-check block:
```typescript
  // Extract acting-user identity from agent requests (MCP server forwarding)
  const actingUser = extractActingUser(request.headers, principal);
  if (actingUser) {
    principal.actingUserId = actingUser.actingUserId;
    principal.actingUserEmail = actingUser.actingUserEmail;
  }
```

This placement ensures every authenticated request path benefits from acting-user extraction, and the data flows through the existing principal into the authorization and audit layers without additional wiring.

**Step 11: Run all tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers && pnpm test`
Expected: ALL PASS (existing 2,431+ tests plus new tests)

**Step 12: Lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers && pnpm lint`
Expected: 0 errors

**Step 13: Commit**

```bash
git add workers/src/types.ts workers/src/auth/acting-user.ts workers/src/auth/roles.ts workers/src/auth/authorization.ts workers/src/index.ts workers/tests/auth/acting-user.spec.ts workers/tests/auth/permission-intersection.spec.ts workers/tests/audit/acting-user-audit.spec.ts
git commit -m "feat(C3): implement acting-user extraction, permission intersection, and audit forwarding"
```

---

## Task 6: Infrastructure - Terraform module and wrangler config validation (C4)

**Files:**
- Create: `terraform/modules/cloudflare-mcp/main.tf`
- Modify: `terraform/environments/sbx1/main.tf`
- Test: `workers/mcp-server/tests/config/wrangler-validation.spec.ts`

**Step 1: Write wrangler config validation test**

Create `workers/mcp-server/tests/config/wrangler-validation.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Wrangler Configuration', () => {
  const wranglerPath = resolve(__dirname, '../../wrangler.jsonc');

  it('should have valid JSONC syntax', () => {
    const content = readFileSync(wranglerPath, 'utf-8');
    // Strip JSONC comments and parse
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(() => JSON.parse(stripped)).not.toThrow();
  });

  it('should configure MCP_OAUTH_KV binding', () => {
    const content = readFileSync(wranglerPath, 'utf-8');
    expect(content).toContain('MCP_OAUTH_KV');
  });

  it('should configure sbx1 environment', () => {
    const content = readFileSync(wranglerPath, 'utf-8');
    expect(content).toContain('"sbx1"');
  });

  it('should configure production environment', () => {
    const content = readFileSync(wranglerPath, 'utf-8');
    expect(content).toContain('"production"');
  });

  it('should set a different port than the main worker (8787)', () => {
    const content = readFileSync(wranglerPath, 'utf-8');
    expect(content).toContain('8788');
  });
});
```

**Step 2: Run test to verify it passes** (wrangler.jsonc already exists from Task 1)

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test -- tests/config/wrangler-validation.spec.ts`
Expected: PASS

**Step 3: Commit test**

```bash
git add workers/mcp-server/tests/config/
git commit -m "test: add wrangler config validation tests for MCP Worker"
```

**Step 4: Create Terraform module for MCP Worker**

Create `terraform/modules/cloudflare-mcp/main.tf`. Follow the pattern established by `terraform/modules/cloudflare/main.tf`:

```hcl
# MCP Server Cloudflare Module
#
# Creates Cloudflare infrastructure resources for the MCP Worker:
# - KV Namespace (OAuth token storage, used by @cloudflare/workers-oauth-provider)
#
# Worker deployment is handled by wrangler, not Terraform.
# This matches the pattern in terraform/modules/cloudflare/main.tf.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.0"
    }
  }
}

variable "environment" {
  description = "Environment name (sbx1, production)"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

# KV Namespace for OAuth token storage
resource "cloudflare_workers_kv_namespace" "mcp_oauth_kv" {
  account_id = var.cloudflare_account_id
  title      = "css-mcp-oauth-kv-${var.environment}"
}

# Outputs
output "mcp_oauth_kv_id" {
  description = "MCP OAuth KV namespace ID (for wrangler.jsonc)"
  value       = cloudflare_workers_kv_namespace.mcp_oauth_kv.id
}

output "mcp_worker_name" {
  description = "MCP Worker name"
  value       = "css-mcp-server-${var.environment}"
}
```

**Step 5: Add MCP module to sbx1 environment**

Add to `terraform/environments/sbx1/main.tf` (after the existing cloudflare module block, before the Outputs section):

```hcl
# -----------------------------------------------------------------------------
# MCP Server Module (OAuth KV)
# -----------------------------------------------------------------------------

module "cloudflare_mcp" {
  source = "../../modules/cloudflare-mcp"

  environment           = local.environment
  cloudflare_account_id = var.cloudflare_account_id
}
```

And add these outputs to the Outputs section:

```hcl
output "mcp_oauth_kv_id" {
  description = "MCP OAuth KV namespace ID for wrangler.jsonc"
  value       = module.cloudflare_mcp.mcp_oauth_kv_id
}

output "mcp_worker_name" {
  description = "MCP Worker name"
  value       = module.cloudflare_mcp.mcp_worker_name
}
```

**Step 6: Commit**

```bash
git add terraform/modules/cloudflare-mcp/ terraform/environments/sbx1/main.tf
git commit -m "feat(C4): add Terraform module for MCP Worker KV namespace"
```

---

## Task 7: End-to-end test suite and full regression check

**Files:**
- Test: `workers/mcp-server/tests/e2e/oauth-mcp-flow.spec.ts`

**Step 1: Write the end-to-end test**

Create `workers/mcp-server/tests/e2e/oauth-mcp-flow.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('End-to-End: OAuth + MCP Flow', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe('unauthenticated access', () => {
    it('GET /health returns 200 without auth', async () => {
      // Create a minimal worker env and call fetch directly
      // Health check is public, should return 200 with status 'healthy'
    });

    it('POST /mcp without auth returns 401', async () => {
      // MCP endpoint requires OAuth token
    });
  });

  describe('OAuth discovery', () => {
    it('GET /.well-known/oauth-authorization-server returns valid metadata', async () => {
      // Should include issuer, authorization_endpoint, token_endpoint,
      // revocation_endpoint, response_types_supported, grant_types_supported
    });
  });

  describe('authenticated tool call', () => {
    it('should execute list_sites tool and forward acting-user headers to backend', async () => {
      // 1. Set up a mock KV with a valid token
      // 2. Send POST /mcp with Bearer token containing a JSON-RPC tools/call for list_sites
      // 3. Intercept the backend fetch and verify it includes:
      //    - X-API-Key: aak_... (agent key from env)
      //    - X-Acting-User-Id: <from token claims>
      //    - X-Acting-User-Email: <from token claims>
      // 4. Verify the tool response is returned correctly
    });
  });

  describe('token lifecycle', () => {
    it('should return 401 for expired access token', async () => {
      // Token with past expiresAt should be rejected
    });

    it('POST /revoke invalidates the token', async () => {
      // After revocation, subsequent requests with the same token should fail
    });
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test -- tests/e2e/`
Expected: Tests should pass against the implementation from Tasks 3-4

**Step 3: Run full regression - all MCP Worker tests**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm test`
Expected: ALL PASS

**Step 4: Run full regression - all CSS backend tests**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers && pnpm test`
Expected: ALL PASS (existing 2,431+ tests plus new acting-user tests)

**Step 5: Lint both projects**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers && pnpm lint`
Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm lint`
Expected: 0 errors in both

**Step 6: Typecheck both projects**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers && pnpm exec tsc --noEmit`
Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/remote-mcp-server-oauth/workers/mcp-server && pnpm typecheck`
Expected: 0 errors in both

**Step 7: Commit test**

```bash
git add workers/mcp-server/tests/e2e/
git commit -m "test: add end-to-end tests for OAuth + MCP flow"
```

---

## Task 8: Update PROGRESS.md

**Files:**
- Modify: `PROGRESS.md`

**Step 1: Update PROGRESS.md**

Add a section documenting the completed phases C1-C4:
- MCP Worker created at `workers/mcp-server/`
- Streamable HTTP transport replacing stdio
- OAuth 2.0 with Google IdP delegation via `@cloudflare/workers-oauth-provider`
- Acting-user forwarding and permission intersection
- Terraform module for MCP Worker infrastructure
- Test counts for new and modified test suites
- Decisions made (D1-D9 from this plan)

**Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: update PROGRESS.md with C1-C4 remote MCP server implementation"
```

---

## File Summary

### New files (MCP Worker)
- `workers/mcp-server/package.json`
- `workers/mcp-server/tsconfig.json`
- `workers/mcp-server/wrangler.jsonc`
- `workers/mcp-server/vitest.config.ts`
- `workers/mcp-server/eslint.config.js`
- `workers/mcp-server/.dev.vars.example`
- `workers/mcp-server/src/index.ts`
- `workers/mcp-server/src/types.ts`
- `workers/mcp-server/src/mcp-handler.ts`
- `workers/mcp-server/src/shared/api-client.ts`
- `workers/mcp-server/src/shared/tools.ts`
- `workers/mcp-server/src/shared/types.ts`
- `workers/mcp-server/src/auth/google-handler.ts`
- `workers/mcp-server/tests/shared/api-client.spec.ts`
- `workers/mcp-server/tests/shared/tools.spec.ts`
- `workers/mcp-server/tests/mcp-handler.spec.ts`
- `workers/mcp-server/tests/health.spec.ts`
- `workers/mcp-server/tests/auth/google-handler.spec.ts`
- `workers/mcp-server/tests/auth/oauth-integration.spec.ts`
- `workers/mcp-server/tests/config/wrangler-validation.spec.ts`
- `workers/mcp-server/tests/e2e/oauth-mcp-flow.spec.ts`

### New files (CSS Backend)
- `workers/src/auth/acting-user.ts`
- `workers/tests/auth/acting-user.spec.ts`
- `workers/tests/auth/permission-intersection.spec.ts`
- `workers/tests/audit/acting-user-audit.spec.ts`

### New files (Infrastructure)
- `terraform/modules/cloudflare-mcp/main.tf`

### Modified files
- `workers/src/types.ts` (add `actingUserId`, `actingUserEmail` to `AuthenticatedPrincipal`)
- `workers/src/auth/roles.ts` (add `minRole` next to existing `maxRole`)
- `workers/src/auth/authorization.ts` (wire permission intersection into `getEffectiveRole`)
- `workers/src/index.ts` (add acting-user extraction after auth)
- `terraform/environments/sbx1/main.tf` (add MCP module)
- `PROGRESS.md`
