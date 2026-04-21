# p1-chatbot

An AI-powered page-building assistant for Puck editor sites connected to the Collaborative State System (CSS).

## Architecture

```
Puck Editor (your site)
  └── @p1/plugin-ai-chat  ← sidebar plugin
        │ WebSocket
        ▼
workers/agent             ← Cloudflare Agent Worker (Durable Object)
  ├── Validates CSS auth token
  ├── Calls Claude via Cloudflare AI Gateway
  └── Executes CSS operations (13 tools)
        │ REST API
        ▼
CSS Backend               ← collaborative-state-system
```

The plugin sends user intent to the Agent Worker over WebSocket. The Worker calls Claude with access to 13 CSS tools (create pages, edit content, check presence, manage edit sessions). Claude's responses stream back token-by-token to the plugin sidebar.

---

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/): `npm install -g wrangler`
- A deployed CSS backend (`collaborative-state-system`) with an agent registered
- An Anthropic API key
- Node.js 18+

---

## 1. Set up Cloudflare AI Gateway (optional)

AI Gateway is a standard Cloudflare product — not something you build. It's optional: leaving `AI_GATEWAY_ACCOUNT_ID` and `AI_GATEWAY_NAME` blank in `wrangler.jsonc` makes the Worker call Anthropic directly.

**Why use it:** request logging, caching (speeds up repeated `list_components` calls), rate limiting, and cost tracking — all visible in the Cloudflare dashboard.

### Create a Gateway (takes ~30 seconds)

1. Go to **Cloudflare Dashboard → AI → AI Gateway**
2. Click **Create Gateway**, give it a name — e.g. `p1-chatbot`
3. Note your **Account ID** (visible in the dashboard URL or under Account Home → Overview)
4. Note the **Gateway Name** you chose

Then set both values in `wrangler.jsonc`:

```jsonc
"AI_GATEWAY_ACCOUNT_ID": "your-cloudflare-account-id",
"AI_GATEWAY_NAME": "p1-chatbot"
```

No provider-specific configuration is needed — the Anthropic API key is passed through automatically. If either var is empty, the Worker falls back to calling Anthropic directly.

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
npm install
```

### Configure secrets

Set these via Wrangler (never commit them):

```bash
wrangler secret put ANTHROPIC_API_KEY
# paste your Anthropic API key

wrangler secret put AGENT_API_KEY
# paste the agent API key from step 2
```

### Configure environment variables

Edit `wrangler.jsonc` and fill in your values:

```jsonc
{
  "vars": {
    "CSS_BACKEND_URL": "https://your-css-backend.workers.dev",
    "AI_GATEWAY_ACCOUNT_ID": "your-cloudflare-account-id",
    "AI_GATEWAY_NAME": "p1-chatbot"
  }
}
```

For the `sbx1` environment, update its `vars` block the same way.

Also set the `AGENT_ID` (not secret, but environment-specific):

```bash
# Add to wrangler.jsonc vars, or set as a secret if preferred
wrangler secret put AGENT_ID
# paste the agent UUID from step 2
```

### Deploy

```bash
# Local development
npm run dev

# Deploy to production
npm run deploy

# Deploy to sbx1 sandbox
npm run deploy:sbx1
```

After deploying, note the Worker URL — e.g. `https://p1-chatbot-agent.your-subdomain.workers.dev`.

---

## 4. Install the Puck plugin

### In your Puck application

```bash
npm install @p1/plugin-ai-chat
```

> Until published to npm, link it locally:
> ```bash
> cd /path/to/p1-chatbot/packages/plugin-ai-chat && npm run build
> # In your Puck app:
> npm install /path/to/p1-chatbot/packages/plugin-ai-chat
> ```

### Wire it up

In your Puck editor component (e.g. `PuckEditorClient.tsx`):

```tsx
import { createAIChatPlugin } from '@p1/plugin-ai-chat';
import { useCSSAuth } from '@pantheon/puck-css'; // or however you access auth

function MyEditor({ siteId, branchId, documentPath, config, data }) {
  const { token } = useCSSAuth();

  const aiPlugin = createAIChatPlugin({
    agentUrl: process.env.NEXT_PUBLIC_AGENT_URL, // your Worker URL
    getAuthToken: () => token,
    getSiteId: () => siteId,
    getBranchId: () => branchId,
    getDocumentPath: () => documentPath,
  });

  return (
    <Puck
      config={config}
      data={data}
      plugins={[aiPlugin]}
    />
  );
}
```

Add `NEXT_PUBLIC_AGENT_URL` to your `.env.local`:

```env
NEXT_PUBLIC_AGENT_URL=https://p1-chatbot-agent.your-subdomain.workers.dev
```

### Airbus ccapture integration

In `PuckEditorClient.tsx`, pass `aiPlugin` via the `additionalPlugins` prop on `useCSSEditor`:

```tsx
const aiPlugin = useMemo(
  () => createAIChatPlugin({
    agentUrl: process.env.NEXT_PUBLIC_AGENT_URL!,
    getAuthToken: () => token,
    getSiteId: () => cssConfig.siteId,       // from your CSS config
    getBranchId: () => activeBranchId,        // from your branch context
    getDocumentPath: () => cssPath,           // the current document path
  }),
  [token, activeBranchId, cssPath],
);

const { puckProps } = useCSSEditor({
  additionalPlugins: [aiPlugin, ...otherPlugins],
  // ...
});
```

---

## 5. Environment variable reference

### Agent Worker (`workers/agent/wrangler.jsonc`)

| Variable | Type | Description |
|---|---|---|
| `CSS_BACKEND_URL` | var | CSS backend base URL |
| `AI_GATEWAY_ACCOUNT_ID` | var | Cloudflare account ID |
| `AI_GATEWAY_NAME` | var | AI Gateway name (e.g. `p1-chatbot`) |
| `ENVIRONMENT` | var | `local`, `sbx1`, or `production` |
| `ANTHROPIC_API_KEY` | secret | Anthropic API key |
| `AGENT_ID` | secret | CSS registered agent UUID |
| `AGENT_API_KEY` | secret | CSS agent API key (`sat_...`) |

### Puck plugin (host application env)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_AGENT_URL` | Agent Worker URL |

---

## 6. How it works

### Plugin sidebar

The `@p1/plugin-ai-chat` plugin adds an **AI Builder** panel to Puck's left sidebar. The user types an intent in natural language:

> "Build me a page about the world's fastest helicopters"

The plugin sends this message to the Agent Worker over WebSocket, along with:
- The current site ID, branch ID, and document path (from plugin options)
- The current Puck document state (from `usePuck()`)
- The user's CSS auth token

### Agent Worker

The Worker validates the auth token against the CSS backend (`GET /api/auth/me`), then starts an agentic loop with Claude:

1. **Claude receives** the user's intent plus the editor context
2. **Claude calls tools** to fulfill the intent:
   - `list_components` → discover available Puck components
   - `create_page` → build a new page document
   - `get_document` → read existing page structure
   - `check_edit_permission` → verify edit access
   - `start_edit_session` → reserve regions
   - `apply_document_edits` → apply changes
   - `complete_edit_session` → finalize
3. **Tokens stream back** to the plugin as Claude explains what it's doing

Tool calls are executed against the CSS backend using the registered agent credentials, with the authenticated user's identity passed via `X-Acting-User-Id` / `X-Acting-User-Email` headers.

### Edit session safety

If the agent loop fails unexpectedly (network error, Claude error, etc.) and an edit session is open, the Worker automatically calls `abort_edit_session` before surfacing the error. This prevents documents from being left in a locked state.

---

## 7. Local development

### Run the Agent Worker locally

```bash
cd workers/agent
npm run dev
# Listens on http://localhost:8787
```

For the Puck app, set:
```env
NEXT_PUBLIC_AGENT_URL=http://localhost:8787
```

The local Worker connects to whatever `CSS_BACKEND_URL` is set to in `wrangler.jsonc` (defaults to `http://localhost:8787` — update if your CSS backend runs on a different port).

### Type checking

```bash
# Agent Worker
cd workers/agent && npx tsc --noEmit

# Plugin
cd packages/plugin-ai-chat && npx tsc --noEmit
```

---

## 8. Available CSS tools

The agent has access to 13 tools covering the full CSS workflow:

| Tool | Purpose |
|---|---|
| `list_sites` | List accessible sites |
| `list_branches` | List branches for a site |
| `list_documents` | List documents on a branch |
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
