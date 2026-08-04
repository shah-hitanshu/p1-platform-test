export interface ChatContext {
  siteId: string;
  branchId: string;
  documentPath: string;
  documentId?: string;
  token: string;
  /** This turn targets a just-created empty page, so the agent should draft without asking. */
  newPage?: boolean;
}

/**
 * One ordered piece of an assistant turn, which interleaves prose and tool calls ("I'll read
 * the page" → read → "That page is empty").
 *
 * **Array position is the chronology** — there is no sequence field, so parts must never be
 * reordered in state. (`turnBlocks` groups them for display; that is a view transform.)
 */
export type MessagePart =
  | TextPart
  | { type: 'tool'; tool: ToolCallStatus };

/**
 * A prose run. Carried through to `TurnBlock` unchanged: grouping a turn for display only
 * affects the tool side, so the two unions share this variant rather than restating it.
 */
export type TextPart = { type: 'text'; id: string; text: string };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /**
   * Concatenated text of the turn. Retained because it is what the agent persists,
   * so replayed history arrives in this shape; also the cheap "has this turn said
   * anything yet" check. Prefer {@link messageParts} for rendering.
   */
  content: string;
  /** Ordered parts. Canonical when present; absent on turns replayed from history. */
  parts?: MessagePart[];
  /** Flat tool list. Legacy shape, still used by replayed history (see {@link messageParts}). */
  toolCalls?: ToolCallStatus[];
  error?: string;
  isStreaming?: boolean;
  /**
   * The user stopped this turn. Distinct from `error`: nothing went wrong, so it reads as
   * a note rather than a failure, and whatever streamed before the stop is kept.
   */
  stopped?: boolean;
}

export interface ToolCallStatus {
  /**
   * Provider tool-call id, used to pair a streamed `tool_end` with the call that
   * produced it. Absent on turns replayed from history, which are already terminal
   * and so never need matching.
   */
  id?: string;
  name: string;
  input?: unknown;
  result?: unknown;
  /**
   * `abandoned`: the turn ended while this call was in flight, so no `tool_end` is coming.
   * Not `error` — it may have succeeded server-side, we just never heard back.
   */
  status: 'running' | 'done' | 'error' | 'abandoned';
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

/** Per-turn overrides for a programmatic send. */
export interface SendMessageOptions {
  /**
   * Override the turn's `documentPath` so the agent edits this page instead of the
   * sidebar's currently-open document. Used to draft into a just-created page.
   */
  documentPath?: string;
  /**
   * Tell the agent this page was just created empty for this brief, so it drafts without
   * asking. Travels in the turn's context, so it never appears in the visible transcript.
   */
  newPage?: boolean;
}

/**
 * One ordered piece of a replayed assistant turn. Carries the position that `content` plus a
 * flat `toolCalls` could not, so a reopened conversation renders as it happened rather than
 * all prose followed by all calls.
 */
export type RestoredPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: RestoredToolCall };

/** A stored turn replayed from the agent, ready to be mapped into a ChatMessage. */
export interface RestoredMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Ordered parts. Canonical when present; absent from a Worker predating them. */
  parts?: RestoredPart[];
  /** Flat call list, used when `parts` is absent. */
  toolCalls?: RestoredToolCall[];
}

/**
 * Frames belonging to a single turn carry the `turnId` the client minted for it, so a late
 * frame from a finished turn isn't applied to the one now running. Optional: a Worker
 * predating the field sends none, and its frames go to the current turn.
 */
interface TurnScoped {
  turnId?: string;
}

// Server → client message types
export type ServerMessage =
  | ({ type: 'token'; content: string } & TurnScoped)
  | ({ type: 'done' } & TurnScoped)
  | ({
      type: 'error';
      error: string;
      /**
       * A failure belonging to the socket, not a turn (rejected `get_history`/`clear`,
       * unparseable frame). Absent on turn errors and on older Workers.
       */
      scope?: 'connection';
    } & TurnScoped)
  | ({ type: 'tool_start'; toolCallId?: string; toolName: string; toolInput?: unknown } & TurnScoped)
  | ({
      type: 'tool_end';
      toolCallId?: string;
      toolName: string;
      toolInput?: unknown;
      toolResult?: unknown;
    } & TurnScoped)
  | { type: 'history'; history: RestoredMessage[] }
  // The agent confirming it stopped the turn. Usually redundant, since the panel ends the
  // turn the moment Stop is pressed, but it is also how a cancel triggered server-side
  // (by a clear) reports back.
  | ({ type: 'cancelled' } & TurnScoped)
  // Acknowledges a 'clear'. The local view is cleared optimistically, so nothing acts on
  // this — it's in the union so the exhaustive switch doesn't treat it as unknown.
  | { type: 'cleared' };
