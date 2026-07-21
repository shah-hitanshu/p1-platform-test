export interface ChatContext {
  siteId: string;
  branchId: string;
  documentPath: string;
  documentId?: string;
  token: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallStatus[];
  error?: string;
  isStreaming?: boolean;
}

export interface ToolCallStatus {
  name: string;
  input?: unknown;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

export interface AIChatPluginOptions {
  /** Base URL of the ChatAgent Cloudflare Worker, e.g. "https://p1-chatbot-agent.workers.dev" */
  agentUrl: string;
  /** Returns the Durable Object key. Defaults to `${userId}-${siteId}`. Override to change history scoping. */
  getAgentId?: () => string;
}

/** A single tool call within a replayed turn — already executed, so it carries its result. */
export interface RestoredToolCall {
  name: string;
  input?: unknown;
  result?: unknown;
}

/** A stored turn replayed from the agent, ready to be mapped into a ChatMessage. */
export interface RestoredMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: RestoredToolCall[];
}

// Server → client message types
export type ServerMessage =
  | { type: 'token'; content: string }
  | { type: 'done' }
  | { type: 'error'; error: string }
  | { type: 'tool_start'; toolName: string; toolInput?: unknown }
  | { type: 'tool_end'; toolName: string; toolResult?: unknown }
  | { type: 'history'; history: RestoredMessage[] };
