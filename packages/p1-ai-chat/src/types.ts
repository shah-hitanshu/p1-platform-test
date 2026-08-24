export interface SelectedBlock {
  /** The component instance's ULID, which is how it is found in a document snapshot. */
  id: string;
  /** Component type, e.g. `HeadingBlock`. */
  type: string;
  /** Dot notation, as the editing tools take it: `content.2`. */
  path: string;
  /** What the editor calls this block on its overlay, e.g. `Heading`. */
  label: string;
  /** A little of what the block says, so it can be named as the user sees it. */
  preview?: string;
  /** How many entries a repeated block has, e.g. a list's items. */
  itemCount?: number;
}

/** A file the user attached, in the shape it travels to the agent in. */
export type Attachment =
  | {
      kind: 'document';
      filename: string;
      /** The file's text, which the agent reads as the brief for this turn. */
      text: string;
    }
  | {
      kind: 'image';
      filename: string;
      /** Inline rather than a link: the gateway refuses to fetch an image for us. */
      dataUrl: string;
    };

/**
 * A file named on a turn in the transcript. `dataUrl`/`text` are present only for a turn sent
 * in this session: the agent stores what a turn's files were called and never the files, so a
 * replayed turn has the name and nothing to open.
 */
export interface AttachedFile {
  kind: Attachment['kind'];
  filename: string;
  dataUrl?: string;
  text?: string;
}

/**
 * A file on the composer, from the moment it is dropped until it leaves with a turn. Held in
 * session state, not the panel's, because reading a file has to survive a Puck remount.
 */
export interface PendingAttachment {
  id: string;
  kind: Attachment['kind'];
  filename: string;
  /** Only 'ready' entries travel with a turn. */
  status: 'pending' | 'ready' | 'error';
  text?: string;
  dataUrl?: string;
  /** Why the file cannot be used. Shown to the user as written. */
  error?: string;
  /** The brief was longer than a turn can carry, so only its first part is here. */
  truncated?: boolean;
}

export interface ChatContext {
  siteId: string;
  branchId: string;
  documentPath: string;
  documentId?: string;
  token: string;
  /** The block selected in the canvas. Context only: it grants nothing. */
  selectedBlock?: SelectedBlock;
  /** Files the user attached to this turn. Not carried forward to later ones. */
  attachments?: Attachment[];
  /**
   * The pages this turn may change; reads are not restricted by it. The Worker enforces it, which
   * is what makes the panel header's "Editing:" list true rather than decorative.
   */
  writeSet?: string[];
  /** This turn targets a just-created empty page, so the agent should draft without asking. */
  newPage?: boolean;
  /**
   * A page the user has asked for that does not exist yet. Carried on every turn until it has
   * been created, because the agent proposes a template first and the answer arrives later.
   */
  pendingPage?: PendingPage;
}

/** Where a page the agent is about to create should go, as the Create Page dialog collected it. */
export interface PendingPage {
  title: string;
  /** Path without a leading slash, matching the paths the agent sees everywhere else. */
  path: string;
}

/**
 * Where a user turn came from, when the user did not type it into the composer. Absent on an
 * ordinary turn, so the transcript annotates only what the user didn't write.
 *
 * Deliberately not persisted: it answers "why is there a message I didn't type", which is only
 * asked of a turn that has just appeared. Replayed history has no field to carry it either.
 */
export interface MessageOrigin {
  source: 'create-page';
  /** The page the request asked for. The brief alone doesn't say where it will land. */
  page: PendingPage;
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
  /** Files sent with this turn, named so the transcript shows what the agent was given. */
  attachments?: AttachedFile[];
  /** Set when the editor seeded this turn instead of the user typing it. */
  origin?: MessageOrigin;
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
 * A one-shot instruction handed to the already-mounted chat panel from elsewhere in the editor
 * (e.g. the Create Page modal's "Generate with AI"), auto-submitted as a chat turn.
 *
 * A closed union rather than an optional `documentPath`: the two arrive under opposite
 * conditions — one waits for its target page to be open, the other has no page at all — and a
 * nullable field would make an unopened panel look like a valid target for both.
 */
export type DraftRequest = FillPageRequest | CreatePageRequest;

/** Draft into a page that already exists, once the panel is looking at it. */
export interface FillPageRequest {
  kind: 'fill-page';
  /** Natural-language brief the agent should act on, shown as the user's chat message. */
  brief: string;
  /** Target document path the turn must edit (overrides the panel's current document). */
  documentPath: string;
  /**
   * The target page was just created empty for this request. Set by the publisher, never
   * inferred, so a caller aiming at an existing page doesn't get "draft immediately" too.
   */
  newPage?: boolean;
}

/**
 * Create a page and build it. The agent proposes the page template it should start from and
 * creates it once the user agrees, so nothing exists when this is published.
 */
export interface CreatePageRequest {
  kind: 'create-page';
  brief: string;
  page: PendingPage;
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
  /**
   * Called with the path of a page the agent has just created, so the editor can open it.
   *
   * More than convenience: the turn's context is built from whatever document the editor has
   * open, so a conversation that stays on the old page keeps aiming later turns at it.
   */
  onPageCreated?: (path: string) => void;
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
   * Which staged files {@link attachments} came from, so the send empties those and only those.
   * A resend replays the originals, whose ids no longer match anything staged.
   */
  attachmentIds?: string[];
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
  /**
   * Seed a page to create rather than edit. Unlike the fields above this outlives the turn: the
   * agent proposes a page template and the user answers on a later one.
   */
  pendingPage?: PendingPage;
  /**
   * Say in the transcript that this turn was seeded rather than typed. Unlike `pendingPage`,
   * which a resend deliberately drops, this survives a retry so the attribution comes back with
   * the turn it describes.
   */
  origin?: MessageOrigin;
  /**
   * Passed explicitly rather than read off state: sending clears the composer, so a retry
   * resends from here.
   */
  attachments?: Attachment[];
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
  /** What this turn's files were called. Names only: no file is stored, so none comes back. */
  attachments?: { kind: Attachment['kind']; filename: string }[];
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
