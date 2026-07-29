export interface ChatContext {
  siteId: string;
  branchId: string;
  documentPath: string;
  documentId?: string;
  token: string;
  /** This turn targets a just-created empty page, so the agent should draft without asking. */
  newPage?: boolean;
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

/**
 * A one-shot instruction handed to the already-mounted chat sidebar from elsewhere in the
 * editor (e.g. the Create Page modal's "Generate with AI"), auto-submitted as a chat turn.
 */
export interface DraftRequest {
  /** Natural-language brief the agent should act on, shown as the user's chat message. */
  brief: string;
  /** Target document path the turn must edit (overrides the sidebar's current document). */
  documentPath: string;
  /** Optional page title, for display/labeling. */
  title?: string;
  /**
   * The target page was just created empty for this request. Set by the publisher, never
   * inferred, so a caller aiming at an existing page doesn't get "draft immediately" too.
   */
  newPage?: boolean;
}

/**
 * Delivers a {@link DraftRequest} to the chat sidebar. The app owns the implementation.
 *
 * One retained slot, not a queue, so a subscriber attaching after the publish still receives
 * it. Publish and consume happen either side of a navigation, which `subscribe` alone misses.
 */
export interface DraftRequestChannel {
  publish(request: DraftRequest): void;
  subscribe(listener: (request: DraftRequest) => void): () => void;
  getLatest(): DraftRequest | null;
  /** Drop the retained request once consumed, so it isn't replayed on a later mount. */
  clearLatest(): void;
}

export interface AIChatPluginOptions {
  /** Base URL of the ChatAgent Cloudflare Worker, e.g. "https://p1-chatbot-agent.workers.dev" */
  agentUrl: string;
  /** Returns the Durable Object key. Defaults to `${userId}-${siteId}`. Override to change history scoping. */
  getAgentId?: () => string;
  /**
   * Channel through which the host app can ask the sidebar to draft a page. When provided,
   * the panel auto-submits each request against its target document. Omit to disable.
   */
  draftRequests?: DraftRequestChannel;
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
