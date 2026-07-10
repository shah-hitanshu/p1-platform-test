# p1-chatbot

An AI-powered page-building assistant for Puck editor sites connected to the Collaborative State System (CSS).

## Architecture

```
Puck Editor (your site)
  └── @pantheon-systems/p1-ai-chat  ← sidebar plugin
        │ WebSocket
        ▼
workers/agent             ← Cloudflare Agent Worker (Durable Object)
  ├── Validates CSS auth token
  ├── Calls the model via Cloudflare AI Gateway (OpenAI-compatible endpoint)
  └── Executes CSS operations (12 tools)
        │ REST API
        ▼
CSS Backend               ← collaborative-state-system
```

The plugin sends user intent to the Agent Worker over WebSocket. The Worker calls the configured model — a native Cloudflare Workers AI model by default, or a partner model such as Claude — with access to 12 tools (create pages, edit content, check presence, manage edit sessions, read media/web pages). The model's responses stream back to the plugin sidebar.

All model calls go through **Cloudflare AI Gateway's OpenAI-compatible endpoint**, so the model is just a string (`AGENT_MODEL`) — switching providers is a config change, not a code change.

---

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) with access to the target account (e.g. the P1 Staging account for staging)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/): `npm install -g wrangler`
- A deployed CSS backend (`collaborative-state-system`) with an agent registered
- A **Cloudflare AI Gateway** and a gateway token (`CF_AIG_TOKEN`) — see step 1
- Node.js 18+

> **No Anthropic API key is needed.** Native `workers-ai/@cf/...` models are billed through Workers AI; partner models (`anthropic/...`) are billed through the gateway's Unified Billing. Either way the Worker authenticates with the gateway token, not a provider key.

---

## 1. Set up Cloudflare AI Gateway (required)

Every model call routes through an AI Gateway, so a gateway must exist and the Worker must have a token for it.

### Create a Gateway (takes ~30 seconds)

1. Go to **Cloudflare Dashboard → AI → AI Gateway**
2. Click **Create Gateway**, give it a name — e.g. `p1-chatbot`
3. Note your **Account ID** (visible in the dashboard URL or under Account Home → Overview)
4. Note the **Gateway Name** you chose

Set both values in the appropriate env block in `wrangler.jsonc`:

```jsonc
"AI_GATEWAY_ACCOUNT_ID": "your-cloudflare-account-id",
"AI_GATEWAY_NAME": "p1-chatbot"
```

### Create a gateway token

Create a Cloudflare **AI Gateway authentication token** (Account → AI Gateway → Run) and provide it to the Worker as the `CF_AIG_TOKEN` secret (see step 3). The Worker rejects a chat request if `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_NAME`, or `CF_AIG_TOKEN` is missing.

### Choose the model

`AGENT_MODEL` selects the model in `provider/model` notation:

- `workers-ai/@cf/moonshotai/kimi-k2.7-code` — native Cloudflare model (default), billed via Workers AI, no gateway credits needed
- `anthropic/claude-haiku-4-5` (or another `anthropic/...` model) — requires the gateway to hold an Anthropic credential (Unified Billing credits or a stored key)

---

## 2. Register an Agent in the CSS system

The Agent Worker authenticates to the CSS backend as a registered agent. Run this against your CSS backend:

```bash
# Replace with your CSS backend URL and a CSS admin token
CSS_URL=https://your-css-backend.workers.dev
ADMIN_TOKEN=your-admin-token

curl -X POST "$CSS_URL/api/agents" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "p1-chatbot",
    "description": "AI page building assistant",
    "capabilities": ["page_creation", "content_editing", "presence"]
  }'
```

The response contains:
```json
{
  "id": "agent-uuid",
  "apiKey": "sat_xxxxxxxxxxxx"
}
```

Save both values — they become `AGENT_ID` and `AGENT_API_KEY`.

---

## 3. Deploy the Agent Worker

### Install dependencies

```bash
cd workers/agent
pnpm install
```

### Configure secrets

Set these via Wrangler for the environment you're deploying (`--env sbx1`, `--env staging`, etc.). Never commit them:

```bash
wrangler secret put CF_AIG_TOKEN --env sbx1
# paste your AI Gateway token

wrangler secret put AGENT_ID --env sbx1
# paste the agent UUID from step 2

wrangler secret put AGENT_API_KEY --env sbx1
# paste the agent API key from step 2
```

For local development, put the same keys in `workers/agent/.env` (gitignored) instead — `wrangler dev` loads them automatically:

```env
CF_AIG_TOKEN=...
AGENT_ID=...
AGENT_API_KEY=...
```

### Configure environment variables

Each environment's `vars` block in `wrangler.jsonc` already carries `CSS_BACKEND_URL`, `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_NAME`, `AGENT_MODEL`, and `MEDIA_WORKER_URL`. Update them for your account/backends as needed.

### Deploy

```bash
# Local development
pnpm dev

# Deploy to sbx1 sandbox
pnpm deploy:sbx1

# Deploy to staging
pnpm deploy:staging
```

After deploying, note the Worker URL — e.g. `https://p1-chatbot-agent-staging.pantheon-content-publisher.workers.dev`.

---

## 4. Install the Puck plugin

### In your Puck application

```bash
pnpm add @pantheon-systems/p1-ai-chat
```

The plugin declares `@pantheon-systems/puck-css`, `@pantheon-systems/pds-toolkit-react`, `@puckeditor/core`, and `react` as peer dependencies — your editor app already provides these.

### Wire it up

`createAIChatPlugin({ agentUrl })` returns a Puck plugin. It sources the current site/branch/document and the CSS auth token from the `@pantheon-systems/puck-css` hooks (`useP1Puck`/`useP1Auth`) internally, so the only required option is the Worker URL:

```tsx
import { createAIChatPlugin } from '@pantheon-systems/p1-ai-chat';

// Inside the editor component, add it to the plugin list.
const aiPlugin = React.useMemo(
  () =>
    process.env.NEXT_PUBLIC_AGENT_URL
      ? createAIChatPlugin({ agentUrl: process.env.NEXT_PUBLIC_AGENT_URL })
      : null,
  [],
);

const { puckProps } = useP1Editor({
  additionalPlugins: aiPlugin ? [...p1Plugins, aiPlugin] : p1Plugins,
  // ...
});
```

Add `NEXT_PUBLIC_AGENT_URL` to your `.env.local`:

```env
NEXT_PUBLIC_AGENT_URL=https://p1-chatbot-agent-staging.pantheon-content-publisher.workers.dev
```

When `NEXT_PUBLIC_AGENT_URL` is unset the plugin is simply not added, so the editor renders unchanged.

---

## 5. Environment variable reference

### Agent Worker (`workers/agent/wrangler.jsonc`)

| Variable | Type | Description |
|---|---|---|
| `CSS_BACKEND_URL` | var | CSS backend base URL |
| `AI_GATEWAY_ACCOUNT_ID` | var | Cloudflare account ID that hosts the gateway |
| `AI_GATEWAY_NAME` | var | AI Gateway name (e.g. `p1-chatbot`) |
| `AGENT_MODEL` | var | Model in `provider/model` notation (defaults to `workers-ai/@cf/moonshotai/kimi-k2.7-code`) |
| `MEDIA_WORKER_URL` | var | Media worker base URL |
| `ENVIRONMENT` | var | `local`, `sbx1`, or `staging` |
| `CF_AIG_TOKEN` | secret | Cloudflare AI Gateway token |
| `AGENT_ID` | secret | CSS registered agent UUID |
| `AGENT_API_KEY` | secret | CSS agent API key (`sat_...`) |

### Puck plugin (host application env)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_AGENT_URL` | Agent Worker URL |

---

## 6. How it works

### Plugin sidebar

The `@pantheon-systems/p1-ai-chat` plugin adds an **AI Builder** panel to Puck's left sidebar. The user types an intent in natural language:

> "Build me a page about the world's fastest helicopters"

The plugin sends this message to the Agent Worker over WebSocket, along with the current site ID, branch ID, and document path, and the user's CSS auth token.

### Agent Worker

The Worker validates the auth token against the CSS backend (`GET /api/auth/me`), then runs an agentic loop with the model:

1. **The model receives** the user's intent plus the editor context
2. **The model calls tools** to fulfill the intent:
   - `list_components` → discover available Puck components
   - `create_page` → build a new page document
   - `get_document` → read existing page structure
   - `check_edit_permission` → verify edit access
   - `start_edit_session` → reserve regions
   - `apply_document_edits` → apply changes
   - `complete_edit_session` → finalize
3. **The reply streams back** to the plugin as the model explains what it's doing

Tool calls are executed against the CSS backend using the registered agent credentials, with the authenticated user's identity passed via `X-Acting-User-Id` / `X-Acting-User-Email` headers.

### Edit session safety

If the agent loop fails unexpectedly (network error, model error, etc.) and an edit session is open, the Worker automatically calls `abort_edit_session` before surfacing the error. This prevents documents from being left in a locked state.

---

## 7. Local development

### Run the Agent Worker locally

```bash
cd workers/agent
pnpm dev
# Listens on http://localhost:8787
```

For the Puck app, set:
```env
NEXT_PUBLIC_AGENT_URL=http://localhost:8787
```

The local Worker connects to whatever `CSS_BACKEND_URL` is set to in `wrangler.jsonc` (defaults to `http://localhost:8787` — update if your CSS backend runs on a different port).

### Type checking and tests

```bash
cd workers/agent
pnpm type-check
pnpm test
```

---

## 8. Available tools

The agent is offered 12 tools (`list_sites`/`list_branches`/`list_documents` are intentionally **not** exposed — the site, branch, and document always come from the editor context):

| Tool | Purpose |
|---|---|
| `list_components` | Discover available Puck components |
| `get_document` | Read current page structure |
| `check_edit_permission` | Verify edit access (pre-flight) |
| `start_edit_session` | Reserve regions for editing |
| `apply_document_edits` | Apply content changes |
| `complete_edit_session` | Finalize a successful edit |
| `abort_edit_session` | Roll back on error or cancellation |
| `get_branch_presence` | See all active users/agents on a branch |
| `get_document_presence` | See who's editing a specific document |
| `create_page` | Create a new page with Puck components |
| `list_media` | List media files in the site's media library |
| `fetch_page` | Fetch a public web page and extract its content |
