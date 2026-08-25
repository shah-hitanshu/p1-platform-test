export interface ChatContext {
  siteId: string;
  branchId: string;
  documentPath: string;
  documentId?: string;
  token: string; // CCR auth token
  /** Context only: a selection grants nothing. */
  selectedBlock?: SelectedBlock;
  /** Files the user attached to this turn. Context only, and not carried to later turns. */
  attachments?: Attachment[];
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

/** A file the user attached to a turn, as it arrives from the browser. */
export type Attachment =
  | { kind: 'document'; filename: string; text: string }
  /** `dataUrl` is the image itself: the gateway will not fetch one, so the bytes come inline. */
  | { kind: 'image'; filename: string; dataUrl: string };

/** Persisted with a turn, unlike the files, so a reopened conversation shows it carried them. */
export interface AttachedFileName {
  kind: Attachment['kind'];
  filename: string;
}

/** Where a page the agent is about to create should go, as the Create Page dialog collected it. */
export interface PendingPage {
  title: string;
  /** Path without a leading slash, matching every other document path the agent sees. */
  path: string;
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
  /** What this turn's files were called. Names only — no file is ever stored. */
  attachments?: AttachedFileName[];
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
