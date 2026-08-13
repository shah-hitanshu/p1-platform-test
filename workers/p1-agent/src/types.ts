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
  token: string; // CSS auth token
  /** Context only: a selection grants nothing. */
  selectedBlock?: SelectedBlock;
  /**
   * Document paths this turn may modify; reads are not restricted by it. Assembled in the browser,
   * so it can only narrow what the acting user's own site role already allows.
   *
   * Optional because the client package and this Worker deploy separately, and can stop being
   * optional once no client predating it is in the field.
   */
  writeSet?: string[];
  /**
   * A page the user asked for that does not exist yet. Sent on every turn until it has been
   * created, because the confirmation the agent waits for arrives on a later one.
   */
  pendingPage?: PendingPage;
  /**
   * The turn was seeded from the Create Page modal against a page that was just created
   * empty for it. Changes the brief's contract: the user asked for a page and expects one,
   * so the agent drafts immediately instead of asking which page to use or what to include.
   *
   * @deprecated Superseded by {@link pendingPage}: the modal no longer creates the page up
   * front. Still honoured because the client package and this Worker deploy independently, so
   * an older client can still send it. Remove once both have shipped past that.
   */
  newPage?: boolean;
}

export interface SelectedBlock {
  id: string;
  type: string;
  path: string;
  label: string;
  preview?: string;
  itemCount?: number;
}

/** All three fields are reported to the model as fact, so a partial selection is dropped. */
export function selectedBlockOf(context: ChatContext): SelectedBlock | null {
  const selected: unknown = context.selectedBlock;
  if (typeof selected !== 'object' || selected === null) return null;
  const { id, type, path, label, preview, itemCount } = selected as {
    id?: unknown; type?: unknown; path?: unknown;
    label?: unknown; preview?: unknown; itemCount?: unknown;
  };
  if (typeof id !== 'string' || id.trim() === '') return null;
  if (typeof type !== 'string' || type.trim() === '') return null;
  if (typeof path !== 'string' || path.trim() === '') return null;
  return {
    id: id.trim(),
    type: type.trim(),
    path: path.trim(),
    // A client too old to send a label leaves the type as its only name.
    label: typeof label === 'string' && label.trim() !== '' ? label.trim() : type.trim(),
    ...(typeof preview === 'string' && preview.trim() !== '' ? { preview: preview.trim() } : {}),
    ...(typeof itemCount === 'number' && Number.isInteger(itemCount) && itemCount > 1
      ? { itemCount }
      : {}),
  };
}

/** Where a page the agent is about to create should go, as the Create Page dialog collected it. */
export interface PendingPage {
  title: string;
  /** Path without a leading slash, matching every other document path the agent sees. */
  path: string;
}

/**
 * Read a pending page off a context that crossed the network. Both fields decide where content
 * the user asked for gets written, so neither is taken on trust.
 */
export function pendingPageOf(context: ChatContext): PendingPage | null {
  const pending: unknown = context.pendingPage;
  if (typeof pending !== 'object' || pending === null) return null;
  const { title, path } = pending as { title?: unknown; path?: unknown };
  if (typeof path !== 'string' || path.trim() === '') return null;
  return { title: typeof title === 'string' ? title : '', path: path.trim() };
}

export type IncomingMessage =
  // `turnId` is minted by the client and echoed on every frame this turn produces, so the
  // client can tell which turn a frame belongs to. Optional for version skew: an older
  // client simply sends none, and gets unstamped frames back.
  | { type: 'chat'; message: string; context: ChatContext; turnId?: string }
  | { type: 'get_history'; token: string }
  | { type: 'clear'; token: string }
  // Stop the turn in flight. Carries no token, unlike get_history/clear: a Stop press
  // must take effect immediately, and a token round trip would let the agent keep
  // mutating the page meanwhile. It is authorized structurally instead — only the
  // connection that started the turn can cancel it, so a guessed Durable Object key
  // cannot interrupt someone else's draft.
  | { type: 'cancel' };

/** Optional for version skew: a client predating the field sends none and gets none back. */
interface TurnScoped {
  turnId?: string;
}

/**
 * A frame produced by a turn, and so eligible for a `turnId`. Stamping a conversation-scoped
 * frame would let a `history` reply end whichever turn was streaming.
 */
export type TurnFrame =
  | { type: 'token'; content: string }
  | { type: 'done' }
  | {
      type: 'error';
      error: string;
      /** The connection's failure, not a turn's. Without it the client ends the live turn. */
      scope?: 'connection';
    }
  // toolCallId pairs a result with its own call; toolName alone misattributes a turn that
  // issues two calls to the same tool.
  | { type: 'tool_start'; toolCallId: string; toolName: string }
  | {
      type: 'tool_end';
      toolCallId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      toolResult: unknown;
    }
  | { type: 'cancelled' };

/** Everything the agent can send. Mirrors `ServerMessage` in the plugin. */
export type OutgoingMessage =
  | (TurnFrame & TurnScoped)
  | { type: 'history'; history: RestoredMessage[] }
  | { type: 'cleared' };

/**
 * A single tool call, flattened for UI replay. Carries the (trimmed) result that
 * was persisted alongside the call so restored turns show the same tool badges.
 */
export interface RestoredToolCall {
  name: string;
  input?: unknown;
  result?: unknown;
}

/** One ordered piece of a replayed assistant turn, carrying the position `content` cannot. */
export type RestoredPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: RestoredToolCall };

/**
 * Persisted conversation collapsed into one entry per visible chat bubble — the shape the
 * plugin renders. One user turn's assistant/tool messages merge into one entry.
 */
export interface RestoredMessage {
  role: 'user' | 'assistant';
  /** The turn's prose, concatenated. Prefer {@link parts}, which carries it in position. */
  content: string;
  /** Ordered parts of an assistant turn. Absent on a user turn. */
  parts?: RestoredPart[];
  /** Flat call list, superseded by {@link parts} and retained for version skew. */
  toolCalls?: RestoredToolCall[];
}

export interface ValidatedUser {
  id: string;
  email: string;
  name?: string;
}
