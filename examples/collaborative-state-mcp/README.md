# Collaborative State MCP Server

An MCP (Model Context Protocol) server that enables Claude Desktop to interact with the Collaborative State System. This allows you to edit documents collaboratively while respecting human presence through the Agent Politeness workflow.

## Overview

This MCP server exposes the following tools to Claude Desktop:

| Tool | Description |
|------|-------------|
| `list_sites` | List all sites accessible to the agent |
| `list_branches` | List all branches for a site |
| `list_documents` | List all documents in a site branch |
| `get_document` | Get document content (optionally a specific region) |
| `check_edit_permission` | Check if editing is allowed (respects human presence) |
| `start_edit_session` | Start an edit session and create a checkpoint |
| `apply_document_edits` | Apply JSON Patch operations to document (requires edit_session_id) |
| `complete_edit_session` | Complete session and create final checkpoint |
| `abort_edit_session` | Abort session and roll back changes |

## Prerequisites

1. **Node.js 20+** installed
2. **Local Collaborative State Worker** running at `http://localhost:8787`
3. **Claude Desktop** with MCP support

## Installation

```bash
cd examples/collaborative-state-mcp
pnpm install
pnpm build
```

## Configuration

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `WORKER_API_URL` | Yes | URL of the Collaborative State Worker | - |
| `AGENT_ID` | Yes | Agent ID from mock-identity.config.json | - |
| `AGENT_API_KEY` | Yes | Agent API key from mock-identity.config.json | - |
| `DEFAULT_SITE_ID` | No | Default site ID for operations | - |
| `DEFAULT_BRANCH_ID` | No | Default branch ID for operations | - |

### Setup .env File

```bash
cp .env.example .env
# Edit .env with your values
```

For local development, use the pre-configured agent from `workers/mock-identity.config.json`:

```env
WORKER_API_URL=http://localhost:8787
AGENT_ID=agent-zappy
AGENT_API_KEY=test-agent-key-zappy
DEFAULT_SITE_ID=site-123
DEFAULT_BRANCH_ID=main
```

## Claude Desktop Configuration

Add this to your Claude Desktop configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "collaborative-state": {
      "command": "node",
      "args": ["/path/to/collaborative-state-system/examples/collaborative-state-mcp/dist/index.js"],
      "env": {
        "WORKER_API_URL": "http://localhost:8787",
        "AGENT_ID": "agent-zappy",
        "AGENT_API_KEY": "test-agent-key-zappy"
      }
    }
  }
}
```

Restart Claude Desktop after updating the configuration.

## Usage Examples

### Example 1: Discover Available Sites

```
You: What sites can you work with?

Claude: [Uses list_sites tool]
I have access to 2 sites:
- My Site (id: site-123)
- Other Site (id: site-456)
```

### Example 2: View Document Content

```
You: What's on the home page?

Claude: [Uses list_branches, list_documents, get_document tools]
The home page contains:
- Title: "Welcome to Our Site"
- Body: "This is the main content..."
```

### Example 3: Edit Document Content

```
You: Fix the grammar in the body text on /home

Claude: [Uses check_edit_permission] Checking if I can edit...
       [Uses start_edit_session] Starting edit session... (editSessionId: session-xyz789)
       [Uses get_document] Fetching current content...
       [Uses apply_document_edits with edit_session_id] Applying corrections...
       [Uses complete_edit_session] Completing session...

Done! I fixed 3 grammatical issues. Checkpoint: checkpoint-abc123
```

### Example 4: Handle Human Conflict

```
You: Update the title on /about

Claude: [Uses check_edit_permission]
Edit permission denied: A human user is currently editing the document.
I'll wait and try again later, or you can ask me once they're done.
```

## Development

### Run Tests

```bash
pnpm test
```

### Run Linting

```bash
pnpm lint
```

### Build

```bash
pnpm build
```

### Test with MCP Inspector

```bash
pnpm inspector
```

This opens the MCP Inspector tool where you can test tools manually.

## Workflow Diagram

```
User Request
     |
     v
[check_edit_permission] ──> Denied? ──> Report to user
     |
     | Allowed
     v
[start_edit_session] ──> Creates checkpoint, returns editSessionId
     |
     | Store editSessionId!
     v
[get_document] ──> Fetch current content
     |
     v
[apply_document_edits] ──> Apply changes (MUST include editSessionId)
     |
     v
[complete_edit_session] ──> Create final checkpoint
     |                         |
     v                         v
  Success                Error? ──> [abort_edit_session]
```

**Important:** The `apply_document_edits` tool requires the `edit_session_id` returned from `start_edit_session`. The backend enforces this requirement to ensure all agent edits occur within a proper edit session with checkpoint protection.

## Troubleshooting

### "WORKER_API_URL environment variable is required"

Make sure you have set the environment variables either in your `.env` file or in the Claude Desktop configuration.

### "Agent is suspended" or "Agent is disabled"

Check the agent status in `workers/mock-identity.config.json`. The agent must have status `active`.

### "Permission denied: active_human_collaborator"

A human user is currently editing the document. Wait for them to finish or ask the user to try later.

### "editSessionId is required for agents"

You tried to apply edits without an active edit session. Always call `start_edit_session` first and include the returned `edit_session_id` in your `apply_document_edits` call.

### "Invalid or expired edit session"

The edit session has expired or was already completed/aborted. Start a new edit session with `start_edit_session`.

### Tools Not Appearing in Claude Desktop

1. Verify the path in `claude_desktop_config.json` is correct
2. Ensure you've run `pnpm build`
3. Check Claude Desktop logs for errors
4. Restart Claude Desktop

## Architecture

```
Claude Desktop
     |
     | (MCP Protocol over stdio)
     v
collaborative-state-mcp
     |
     | (HTTP/REST)
     v
Collaborative State Worker (localhost:8787)
     |
     v
DocumentSession Durable Object
```

## License

Part of the Collaborative State System project.
