export interface Env {
  // Durable Object binding
  CHAT_AGENT: DurableObjectNamespace;

  // Environment vars
  ENVIRONMENT: string;
  CSS_BACKEND_URL: string;
  MEDIA_WORKER_URL: string;

  // AI Gateway — all model calls go through the OpenAI-compatible endpoint at
  // gateway.ai.cloudflare.com/v1/{account}/{name}/compat, so the model is just a
  // string (native @cf/... or partner anthropic/...). Both IDs are required.
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_NAME: string;

  // Model to use, in the gateway compat endpoint's provider/model notation
  // (e.g. workers-ai/@cf/... or anthropic/...). Optional — defaults in agent.ts.
  AGENT_MODEL?: string;

  // Secrets (set via wrangler secret / .dev.vars)
  AGENT_ID: string;
  AGENT_API_KEY: string;
  // Cloudflare AI Gateway token — authenticates the Worker to the gateway. Required.
  // Native @cf models bill via Workers AI; partner models bill via the gateway's
  // unified billing / stored key (no per-request provider key needed).
  CF_AIG_TOKEN: string;
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
