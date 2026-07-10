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
  | { type: 'clear' };

export interface OutgoingMessage {
  type: 'token' | 'done' | 'error' | 'tool_start' | 'tool_end' | 'cleared';
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  error?: string;
}

export interface ValidatedUser {
  id: string;
  email: string;
  name?: string;
}
