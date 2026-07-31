# Collaborative State MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that enables AI assistants like Claude to read and edit documents in the Collaborative State System. The server authenticates as a registered agent and follows the Agent Politeness protocol to safely coexist with human editors.

## Prerequisites

- Node.js 20+
- pnpm
- A running Collaborative State System backend (local or remote)
- A registered agent with an API key and site role grants

## Quick Start

### 1. Install and build

```bash
cd examples/collaborative-state-mcp
pnpm install
pnpm build
```

### 2. Register an agent and generate an API key

You can do this through the **admin UI**, via **curl**, or use the **local dev shortcut**.

#### Option A: Admin UI

1. Start the frontend (`make frontend-dev`) and navigate to http://localhost:5173/agents
2. Click **"+ Register agent"**, enter a name and description, then click **Register**
3. Expand the agent row and click **"Generate key"**
4. Copy the key immediately -- it starts with `aak_` and is shown only once
5. Navigate to a site's detail page and grant the agent a role under **Agent Access**

#### Option B: curl

Requires a valid user auth token (from the mock identity provider or Auth0).

```bash
# Default organization ID (from seed data)
ORG_ID="00000000-0000-0000-0000-000000000000"

# 1. Register the agent
curl -s -X POST http://localhost:8787/api/organizations/$ORG_ID/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user-token>" \
  -d '{"name": "My MCP Agent", "description": "Claude integration"}'
# Note the "id" from the response

# 2. Generate an API key
AGENT_ID="<agent-id-from-above>"
curl -s -X POST http://localhost:8787/api/agents/$AGENT_ID/keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user-token>" \
  -d '{"name": "Claude Desktop Key"}'
# Copy the "key" field (starts with aak_) -- shown only once

# 3. Grant the agent a site role
SITE_ID="<target-site-id>"
curl -s -X POST http://localhost:8787/api/agents/$AGENT_ID/roles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user-token>" \
  -d "{\"siteId\": \"$SITE_ID\", \"role\": \"editor\"}"
```

Valid roles: `viewer` (read-only), `editor` (read/write), `admin` (full access).

#### Option C: Local dev shortcut (mock identity)

For local development, the backend includes a pre-configured mock agent. No registration or key generation needed:

| Field | Value |
|-------|-------|
| Agent ID | `a0000000-0000-0000-0000-000000000001` |
| API Key | `test-agent-key-zappy` |
| Name | Zappy AI Assistant |
| Site access | `site-123` (editor) |

Copy the example config which is pre-populated with these values:

```bash
cp .env.example .env
```

### 3. Configure environment

Create or edit the `.env` file:

```bash
# Required
WORKER_API_URL=http://localhost:8787
AGENT_ID=<your-agent-id>
AGENT_API_KEY=<your-aak_key>

# Optional -- set defaults so tools don't require siteId/branchId every call
DEFAULT_SITE_ID=<site-id>
DEFAULT_BRANCH_ID=main
```

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKER_API_URL` | Yes | Backend URL (e.g., `http://localhost:8787`) |
| `AGENT_ID` | Yes | UUID of the registered agent |
| `AGENT_API_KEY` | Yes | API key (`aak_...` for real keys, or mock key for local dev) |
| `DEFAULT_SITE_ID` | No | Default site for tool calls |
| `DEFAULT_BRANCH_ID` | No | Default branch for tool calls |

### 4. Connect to Claude Desktop

Edit your Claude Desktop config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "collaborative-state": {
      "command": "node",
      "args": ["/absolute/path/to/examples/collaborative-state-mcp/dist/index.js"],
      "env": {
        "WORKER_API_URL": "http://localhost:8787",
        "AGENT_ID": "<your-agent-id>",
        "AGENT_API_KEY": "<your-aak_key>"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### 5. Connect to Claude Code

```bash
claude mcp add collaborative-state \
  node /absolute/path/to/examples/collaborative-state-mcp/dist/index.js \
  -e WORKER_API_URL=http://localhost:8787 \
  -e AGENT_ID=<your-agent-id> \
  -e AGENT_API_KEY=<your-aak_key>
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_sites` | List all sites accessible to the agent |
| `list_branches` | List all branches for a site |
| `list_documents` | List all documents on a branch |
| `get_document` | Fetch document content as JSON |
| `check_edit_permission` | Check if the agent can edit (respects human presence) |
| `start_edit_session` | Begin an edit session with checkpoint protection |
| `apply_document_edits` | Apply JSON Patch operations (requires `edit_session_id`) |
| `complete_edit_session` | Finish editing and create a final checkpoint |
| `abort_edit_session` | Cancel editing and roll back changes |

## Agent Politeness Workflow

The MCP server follows the **Agent Politeness** protocol. Agents must check for human presence before editing and operate within edit sessions that provide checkpoint-based rollback:

```
1. check_edit_permission  -->  Is a human currently editing?
       |                           |
       | No                        | Yes --> Wait or skip
       v
2. start_edit_session     -->  Creates safety checkpoint, returns editSessionId
       |
       v
3. get_document           -->  Read current content
       |
       v
4. apply_document_edits   -->  Apply changes (MUST include editSessionId)
       |
       v
5. complete_edit_session  -->  Finalize with checkpoint
```

If a human begins editing while the agent has an active session, the agent should call `abort_edit_session` to roll back gracefully.

## Authentication

The MCP server sends the agent API key via the `X-API-Key` header on every request. The backend authentication flow:

1. Recognizes the `aak_` prefix and routes to the `AgentApiKeyProvider`
2. Validates the key by comparing its SHA-256 hash against the database
3. Looks up the agent's per-site roles from the `agent_site_roles` table
4. Returns an authenticated principal with `type: 'agent'` and populated `pantheonSiteRoles`

For local development with mock identity, the `MockIdentityProvider` handles non-`aak_` keys by matching against the hardcoded mock agent list.

### Role Mapping

Agent site roles map to internal authorization levels:

| Agent Role | Pantheon Role | Capabilities |
|------------|---------------|--------------|
| `viewer` | `team_member` | Read documents and branches |
| `editor` | `developer` | Read and edit documents |
| `admin` | `admin` | Full access including branch and site management |

## Usage Examples

### Discover available sites

```
You: What sites can you work with?
Claude: [Uses list_sites] I have access to "My Site" (site-123).
```

### View document content

```
You: What's on the home page?
Claude: [Uses list_documents, get_document]
        The home page has a title "Welcome" and body content...
```

### Edit a document

```
You: Fix the typo in the about page title
Claude: [Uses check_edit_permission] Checking permissions...
        [Uses start_edit_session] Starting session...
        [Uses get_document] Reading current content...
        [Uses apply_document_edits] Applying fix...
        [Uses complete_edit_session] Done! Changes saved.
```

## Development

```bash
pnpm dev          # Watch mode (recompiles on changes)
pnpm build        # One-time build
pnpm test         # Run tests
pnpm lint         # Lint source code
pnpm inspector    # Launch MCP Inspector for interactive debugging
```

## Architecture

```
Claude Desktop / Claude Code
     |
     | (MCP Protocol over stdio)
     v
collaborative-state-mcp (this server)
     |
     | (HTTP + X-API-Key header)
     v
Collaborative State Worker (localhost:8787)
     |
     |--- PostgreSQL (versions, roles, keys)
     |--- Durable Objects (real-time CRDT state)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Authentication required" | Verify `AGENT_API_KEY` is correct and not revoked |
| "Forbidden" on operations | Grant the agent a site role (viewer/editor/admin) |
| "Agent cannot edit" | A human is editing the document; wait and retry |
| "editSessionId is required" | Call `start_edit_session` before `apply_document_edits` |
| Tools not appearing in Claude | Check the path to `dist/index.js`, run `pnpm build`, restart Claude |
| Agent is suspended/disabled | Update agent status to `active` via the admin UI |
