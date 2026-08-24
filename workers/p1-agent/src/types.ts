export interface Env {
  // Durable Object binding
  CHAT_AGENT: DurableObjectNamespace;

  // Environment vars
  ENVIRONMENT: string;
  CSS_BACKEND_URL: string;
  MEDIA_WORKER_URL: string;

  // Logger config — see telemetry.ts.
  LOG_LEVEL?: string;
  APP_VERSION?: string;
  /** Local ndjson collector, e.g. `http://127.0.0.1:8799`. Unset in every deployed env. */
  P1_LOG_SINK?: string;

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
  // Whether AGENT_MODEL can see images: "true" or "false". Set it alongside AGENT_MODEL —
  // see modelSeesImages for what an unset value assumes.
  AGENT_MODEL_VISION?: string;

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

/** A file the user attached to a turn, as it arrives from the browser. */
export type Attachment =
  | { kind: 'document'; filename: string; text: string }
  /** `dataUrl` is the image itself: the gateway will not fetch one, so the bytes come inline. */
  | { kind: 'image'; filename: string; dataUrl: string };

/** Matches the panel's own cap, and bounds what one turn's attachments can cost. */
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_TEXT_CHARS = 20_000;
const MAX_FILENAME_LENGTH = 200;

/** The browser shrinks to 1024px, well under this: a backstop for a client that does not. */
const MAX_IMAGE_DATA_URL_CHARS = 8 * 1024 * 1024;

/**
 * What the panel encodes to, plus what a browser without WebP falls back to. AVIF is absent
 * deliberately: the Anthropic transport cannot carry it, and accepting it here would put a
 * file in the prompt as seen while the request travelled without it.
 */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Reported to the model as the end of the brief, so a cut file does not read as a whole one. */
const TRUNCATION_MARKER = '\n\n[…the rest of this file was not included]';

function attachmentText(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.length > MAX_ATTACHMENT_TEXT_CHARS
    ? value.slice(0, MAX_ATTACHMENT_TEXT_CHARS) + TRUNCATION_MARKER
    : value;
}

/**
 * A base64 image data URI, or null. Copied into the provider request as it stands, so the
 * media type and the payload's alphabet are both checked rather than trusted.
 */
function attachmentDataUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_DATA_URL_CHARS) return null;
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  const [, mediaType, payload] = match;
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) return null;
  // A base64 payload's length is always a multiple of four; anything else was truncated or
  // hand-assembled, and providers reject it unhelpfully.
  if (payload.length === 0 || payload.length % 4 !== 0) return null;
  return value;
}

function attachmentFilename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_FILENAME_LENGTH) return null;
  return trimmed;
}

function parseAttachment(entry: unknown): Attachment | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { kind, filename, text, dataUrl } = entry as {
    kind?: unknown; filename?: unknown; text?: unknown; dataUrl?: unknown;
  };
  const name = attachmentFilename(filename);
  if (name === null) return null;
  if (kind === 'document') {
    const body = attachmentText(text);
    return body === null ? null : { kind: 'document', filename: name, text: body };
  }
  if (kind === 'image') {
    const image = attachmentDataUrl(dataUrl);
    return image === null ? null : { kind: 'image', filename: name, dataUrl: image };
  }
  return null;
}

/** A turn's files: those that will travel, and separately why the rest will not. */
export interface ReadAttachments {
  attachments: Attachment[];
  /** Examined and rejected. A drop here is version skew or a bug in the client. */
  invalid: number;
  /** Arrived past the cap, so never examined. Nothing is wrong with them. */
  overLimit: number;
}

/**
 * Read the files a turn arrived with. Each variant's payload is checked, not just its `kind`:
 * both reach the prompt as fact, and an image is copied into a provider request.
 *
 * Only the first {@link MAX_ATTACHMENTS} are examined, so an oversized list cannot buy
 * unbounded validation work.
 */
export function readAttachments(context: ChatContext): ReadAttachments {
  const raw: unknown[] = Array.isArray(context.attachments) ? context.attachments : [];
  const examined = raw.slice(0, MAX_ATTACHMENTS);
  const attachments: Attachment[] = [];
  for (const entry of examined) {
    const attachment = parseAttachment(entry);
    if (attachment !== null) attachments.push(attachment);
  }
  return {
    attachments,
    invalid: examined.length - attachments.length,
    overLimit: raw.length - examined.length,
  };
}

export function attachmentsOf(context: ChatContext): Attachment[] {
  return readAttachments(context).attachments;
}

/** Persisted with a turn, unlike the files, so a reopened conversation shows it carried them. */
export interface AttachedFileName {
  kind: Attachment['kind'];
  filename: string;
}

export function attachmentNames(attachments: Attachment[]): AttachedFileName[] {
  return attachments.map(({ kind, filename }) => ({ kind, filename }));
}

/** Read names off a stored entry: written by us, but read back after an arbitrary deploy. */
export function attachmentNamesOf(value: unknown): AttachedFileName[] {
  if (!Array.isArray(value)) return [];
  const names: AttachedFileName[] = [];
  for (const entry of value.slice(0, MAX_ATTACHMENTS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { kind, filename } = entry as { kind?: unknown; filename?: unknown };
    if (kind !== 'image' && kind !== 'document') continue;
    const name = attachmentFilename(filename);
    if (name !== null) names.push({ kind, filename: name });
  }
  return names;
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
