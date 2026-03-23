# Proposal 004: Remote MCP Server with OAuth Authentication

**Status:** Draft
**Date:** 2026-03-23
**Author:** Claude (via collaborative session)
**Affects:** MCP Server, CSS Backend (audit), Infrastructure (Terraform/Wrangler)

---

## Summary

Deploy the MCP server as a remote Cloudflare Worker with OAuth 2.0 authentication, enabling Claude Desktop and Claude Code users to connect to sandbox and production environments without running a local MCP server. The MCP server delegates authentication to the organization's identity provider (Google OAuth today, Pantheon MAS/Auth0 FGA in the future) and forwards user identity to the CSS backend for audit.

---

## Motivation

The current MCP server runs locally via stdio with a hardcoded agent API key. This works for development but doesn't scale to shared environments:

- **No user identity** -- actions are attributed to the agent, not the human who invoked them
- **No access control** -- anyone with the API key has the agent's full permissions
- **Local-only** -- each user must clone the repo, build the server, and configure credentials
- **Key distribution** -- sharing `aak_` keys out-of-band is insecure

A remote MCP server with OAuth solves all of these by authenticating users through the existing IdP and running as a managed service.

---

## Architecture

```
Claude Desktop / Claude Code
     |
     | 1. MCP OAuth discovery
     | 2. Browser redirect to IdP (Google / MAS)
     | 3. User authenticates
     | 4. MCP server issues scoped access token
     | 5. Streamable HTTP with Bearer token
     v
MCP Server (Cloudflare Worker)        <-- NEW: remote, authenticated
     |
     | Validates user JWT (Google / MAS JWKS)
     | Resolves user's site permissions
     | Signs requests with agent API key (server secret)
     | Forwards acting-user identity
     |
     | X-API-Key: aak_... (KV/secret)
     | X-Acting-User-Id: <user-uuid>
     | X-Acting-User-Email: <user-email>
     v
CSS Backend (existing Cloudflare Worker)
     |
     | Authenticates agent via aak_ key
     | Records acting user in audit trail
     v
PostgreSQL
```

### Key Design Decisions

1. **MCP server as OAuth Authorization Server** -- The MCP spec requires the server to implement the OAuth 2.0 Authorization Server role. Internally, it delegates to the real IdP (Google/MAS). The `@cloudflare/workers-oauth-provider` package handles this pattern.

2. **Agent key is a server secret** -- The `aak_` key lives in the MCP Worker's secrets (Wrangler secrets or KV), never exposed to end users. Users authenticate as themselves; the MCP server acts on their behalf using the agent's credentials.

3. **Acting-user forwarding** -- The CSS backend receives both the agent identity (from the API key) and the acting user identity (from forwarded headers). Audit events record both.

4. **Streamable HTTP transport** -- Replaces stdio. This is the MCP spec's recommended transport for remote servers and is supported by Claude Desktop and Claude Code.

---

## Phase Plan

### Phase C1: Convert MCP Server to Cloudflare Worker

**Goal:** Port the existing MCP server from a Node.js stdio process to a Cloudflare Worker with Streamable HTTP transport.

**Work items:**
- [ ] Create new Worker project (`workers-mcp/` or similar) with Wrangler config
- [ ] Port `api-client.ts`, `config.ts`, and tool definitions to Worker-compatible code
- [ ] Replace stdio transport with `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`
- [ ] Read agent credentials from Worker secrets (`AGENT_API_KEY`, `AGENT_ID`) instead of env vars
- [ ] Add health check endpoint (`GET /health`)
- [ ] Verify all 9 tools work via MCP Inspector over HTTP
- [ ] Write tests for the transport layer

**Does not include:** Authentication (all requests accepted in this phase for testing).

### Phase C2: OAuth 2.0 Authorization (Google)

**Goal:** Add OAuth 2.0 to the MCP Worker so users authenticate via Google before using tools.

**Work items:**
- [ ] Add `@cloudflare/workers-oauth-provider` dependency
- [ ] Implement OAuth 2.0 Authorization Server endpoints:
  - `GET /.well-known/oauth-authorization-server` (metadata discovery)
  - `GET /authorize` (redirect to Google OAuth)
  - `POST /token` (exchange auth code for MCP access token)
  - `POST /revoke` (token revocation)
- [ ] Configure Google OAuth client credentials (client ID, client secret in Worker secrets)
- [ ] On successful auth, issue an MCP-scoped access token containing user claims (`sub`, `email`, `name`)
- [ ] Validate MCP access token on every tool call
- [ ] Store token-to-user mapping in KV or Durable Object for session management
- [ ] Add user identity to tool execution context
- [ ] Test end-to-end with Claude Desktop and Claude Code

**Configuration required:**
```
# Worker secrets
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
AGENT_API_KEY=aak_<generated-key>
AGENT_ID=<registered-agent-uuid>
```

### Phase C3: Acting-User Forwarding and Audit

**Goal:** Forward the authenticated user's identity to the CSS backend so agent actions are attributed to the user who initiated them.

**Work items:**
- [ ] MCP server adds `X-Acting-User-Id` and `X-Acting-User-Email` headers to CSS backend requests
- [ ] CSS backend: extract acting-user headers when principal is `type: 'agent'`
- [ ] Store acting user on `AuthenticatedPrincipal` (new optional fields: `actingUserId`, `actingUserEmail`)
- [ ] Update audit emitter to include acting user in audit events
- [ ] Add `acting_user_id` and `acting_user_email` columns to relevant audit tables (or include in JSONB metadata)
- [ ] Authorization check: verify the acting user has at least the permissions the agent is exercising (defense in depth -- the agent's role is the ceiling, not a bypass)
- [ ] Write tests for header extraction, audit recording, and permission intersection

**Security consideration:** The `X-Acting-User-*` headers must only be trusted from authenticated agent principals. If a regular user sends these headers, they must be ignored.

### Phase C4: Infrastructure and Deployment

**Goal:** Deploy the MCP Worker to sandbox and production with Terraform.

**Work items:**
- [ ] Wrangler configuration for the MCP Worker (`wrangler.jsonc`)
  - Routes: `mcp.{domain}/` or `css-mcp.{domain}/`
  - KV namespace for session/token storage
  - Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AGENT_API_KEY`, `AGENT_ID`
  - Environment variables: `CSS_BACKEND_URL`, `ENVIRONMENT`
- [ ] Terraform module for the MCP Worker (mirrors existing `workers` module)
- [ ] Register the MCP server's agent in each environment (sandbox, production)
- [ ] Generate and store `aak_` keys per environment
- [ ] Grant the MCP agent appropriate site roles per environment
- [ ] Configure Google OAuth redirect URIs for each environment's MCP URL
- [ ] Add monitoring/alerting for the MCP Worker
- [ ] Document the deployment process

### Phase C5: MAS Integration (Future)

**Goal:** Support Pantheon MAS (Auth0 FGA) as an identity provider alongside or replacing Google.

**Work items:**
- [ ] Add MAS as a second IdP option in the OAuth flow
- [ ] Support IdP selection at `/authorize` (query param or tenant config)
- [ ] Validate MAS-issued JWTs using the MAS JWKS endpoint
- [ ] Map MAS user claims to the same internal user identity format
- [ ] When MAS is primary: use MAS roles/permissions to drive authorization instead of (or in addition to) agent site roles
- [ ] Update Terraform for MAS client credentials per environment
- [ ] Deprecate Google OAuth path when MAS migration is complete

**Migration path:**
| Stage | `/authorize` behavior | Token validation |
|-------|----------------------|-----------------|
| Current | Google only | Google JWKS |
| Transition | Google or MAS (config flag or user choice) | Check `iss` claim, route to correct JWKS |
| Final | MAS only | MAS JWKS |

---

## Security Model

### Authentication layers

| Layer | Mechanism | Who is verified |
|-------|-----------|----------------|
| User to MCP Server | OAuth 2.0 (Google/MAS) | The human user |
| MCP Server to CSS Backend | `aak_` API key | The agent |
| Acting-user forwarding | Signed headers (agent-only) | Attribution to human |

### Threat mitigations

| Threat | Mitigation |
|--------|------------|
| Unauthorized MCP access | OAuth 2.0 -- no valid token, no tool access |
| Agent key exposure | Key stored as Worker secret, never sent to clients |
| Privilege escalation via acting-user headers | Backend only trusts these headers from agent principals |
| User exceeding their permissions via agent | Phase C3: intersect user permissions with agent permissions |
| Token theft | Short-lived MCP tokens, revocation endpoint, HTTPS only |
| IdP migration risk | Multi-provider validation based on `iss` claim |

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| `@cloudflare/workers-oauth-provider` | Available | Cloudflare's OAuth server library for Workers |
| `@modelcontextprotocol/sdk` | In use | Already used by the stdio MCP server |
| Google OAuth client | Exists | Same client used by the frontend (may need new redirect URIs) |
| Auth0 / MAS | Future | Pantheon's MAS service -- timing TBD |
| CSS Backend agent auth (Phase B) | Complete | `aak_` keys, site roles, and auth provider are all wired |

---

## Open Questions

1. **Shared vs. per-environment agents?** Should the MCP server use one agent identity across all environments, or a separate registered agent per environment (sandbox, production)?
   - **Recommendation:** Separate agents per environment. Limits blast radius and allows different role grants.

2. **MCP server URL structure?** Options:
   - Subdomain: `mcp.css.example.com`
   - Path prefix on existing worker: `css.example.com/mcp/`
   - Separate worker: `css-mcp.example.com`
   - **Recommendation:** Separate worker on a subdomain. Keeps deployment independent.

3. **Token lifetime?** How long should MCP access tokens live before requiring re-auth?
   - **Recommendation:** 8 hours (a workday). Refresh tokens with 30-day lifetime.

4. **Rate limiting?** Should the MCP server enforce per-user rate limits?
   - **Recommendation:** Yes, via Cloudflare's built-in rate limiting. Prevents runaway agent loops.

5. **Existing stdio MCP server?** Keep it for local development or deprecate?
   - **Recommendation:** Keep it. Local stdio is simpler for development and doesn't require OAuth setup.
