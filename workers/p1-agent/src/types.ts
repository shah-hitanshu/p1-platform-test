export interface Env {
  // Durable Object binding
  CHAT_AGENT: DurableObjectNamespace;

  // Environment vars
  ENVIRONMENT: string;
  CSS_BACKEND_URL: string;
  MEDIA_WORKER_URL: string;

  // AI Gateway REST API — model calls go through
  // api.cloudflare.com/client/v4/accounts/{AI_GATEWAY_ACCOUNT_ID}/ai/v1/{chat/completions|messages}.
  // AI_GATEWAY_ACCOUNT_ID is the Cloudflare account id (used in the URL path);
  // AI_GATEWAY_NAME is the gateway id, sent as the cf-aig-gateway-id header. Both required.
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_NAME: string;

  // Model to use, as "provider/model" (must contain a slash), e.g. @cf/moonshotai/...,
  // openai/gpt-4o, google-ai-studio/gemini-2.5-flash, anthropic/claude-... An `anthropic/`
  // prefix selects the /messages endpoint; everything else uses /chat/completions.
  // Optional — defaults in agent.ts.
  AGENT_MODEL?: string;

  // Secrets (set via wrangler secret / .dev.vars)
  AGENT_ID: string;
  AGENT_API_KEY: string;
  // Cloudflare API token (AI Gateway Read/Edit + Workers AI Read) — authenticates the
  // Worker to the REST API via Bearer auth. Providers bill through the gateway's unified
  // billing, so no per-provider (Anthropic/OpenAI/…) key is needed.
  AI_GATEWAY_API_TOKEN: string;
}

export interface ChatContext {
  siteId: string;
  branchId: string;
  documentPath: string;
  documentId?: string;
  puckData?: Record<string, unknown>;
  token: string; // CSS auth token
  userId?: string;
  userEmail?: string;
}

export type IncomingMessage =
  | { type: 'chat'; message: string; context: ChatContext }
  | { type: 'get_history'; token: string }
  | { type: 'clear'; token: string };

export interface OutgoingMessage {
  type: 'token' | 'done' | 'error' | 'tool_start' | 'tool_end' | 'cleared' | 'history';
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  error?: string;
  history?: RestoredMessage[];
}

/**
 * A single tool call, flattened for UI replay. Carries the (trimmed) result that
 * was persisted alongside the call so restored turns show the same tool badges.
 */
export interface RestoredToolCall {
  name: string;
  input?: unknown;
  result?: unknown;
}

/**
 * Persisted conversation collapsed into one entry per visible chat bubble — the
 * shape the plugin renders. All the assistant/tool messages the agentic loop
 * produced for a single user turn are merged into one assistant entry so replay
 * matches what streaming showed live.
 */
export interface RestoredMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: RestoredToolCall[];
}

export interface ValidatedUser {
  id: string;
  email: string;
  name?: string;
}
