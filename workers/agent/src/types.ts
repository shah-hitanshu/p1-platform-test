export interface Env {
  // Durable Object binding
  CHAT_AGENT: DurableObjectNamespace;

  // Environment vars
  ENVIRONMENT: string;
  CSS_BACKEND_URL: string;
  MEDIA_WORKER_URL: string;
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_NAME: string;

  // Secrets (set via wrangler secret)
  ANTHROPIC_API_KEY: string;
  AGENT_ID: string;
  AGENT_API_KEY: string;
  CF_AIG_TOKEN?: string; // optional — only needed if gateway has auth enabled
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
