import { Agent } from 'agents';
import type { AgentContext, Connection, ConnectionContext, WSMessage } from 'agents';
import type { ChatContext, Env, IncomingMessage, OutgoingMessage, TurnFrame, ValidatedUser } from './types.js';
import { McpApiClient } from './css-api.js';
import { CSS_TOOLS, WEB_TOOLS, executeTool } from './tools.js';
import { validateCSSToken } from './auth.js';
import { createdDocumentPath, withCreatedPage } from './scope.js';
import { appendTurn, sanitizeHistory, trimForHistory, buildRestoredHistory, turnMayCommit, turnHasOutput } from './history.js';
import {
  createTransport,
  apiErrorStatus,
  isAbortError,
  type ChatMessage,
  type CompletionResult,
} from './model.js';
import { SYSTEM_PROMPT, buildContextNote } from './prompt.js';
import { ensureLogger } from './telemetry.js';

// Default model. AGENT_MODEL is "provider/model" (must contain a slash): an `anthropic/`
// prefix routes to the Anthropic /messages endpoint; everything else — including bare
// Workers AI ids like `@cf/...` — routes to the OpenAI-compatible /chat/completions
// endpoint. Override per env via AGENT_MODEL.
const DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.7-code';

interface AgentState {
  conversationHistory: ChatMessage[];
  // The validated user who owns this conversation, established on the first
  // authenticated chat turn. get_history/clear require the caller's token to
  // resolve to this id — the DO key is built from non-secret, guessable ids, so
  // ownership can't rely on the key alone.
  ownerId?: string;
  /**
   * Incremented on every clear. A turn records this before it starts and refuses to
   * persist if it changed, so a clear that lands mid-turn cannot be undone by the
   * write at the end of that turn.
   */
  clearSeq?: number;
}

/** The one call {@link resolveFollowsTemplate} needs, so a test can stand in for the client. */
interface DocumentLookup {
  lookupDocumentByPath(
    siteId: string,
    documentPath: string,
  ): Promise<{ templateId?: string } | null>;
}

/**
 * Whether the turn's target page is bound to a page template, which changes what editing it
 * safely means. Read from the backend rather than the context, because the context is assembled
 * in the browser and this decides an instruction the agent is told to obey.
 */
export async function resolveFollowsTemplate(
  api: DocumentLookup,
  context: Pick<ChatContext, 'siteId' | 'documentPath'>,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const { siteId, documentPath } = context;
  if (!siteId || !documentPath) return false;

  const known = cache.get(documentPath);
  if (known !== undefined) return known;

  try {
    const doc = await api.lookupDocumentByPath(siteId, documentPath);
    const follows = !!doc?.templateId;
    cache.set(documentPath, follows);
    return follows;
  } catch (err) {
    // Losing the note beats failing the turn, the same trade the post-apply structure check
    // makes. Left uncached so one failure doesn't mute it for the rest of the conversation.
    console.warn('[template] lookup failed, omitting the template note:', err);
    return false;
  }
}

export class ChatAgent extends Agent<Env, AgentState> {
  initialState: AgentState = { conversationHistory: [] };

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    // A Durable Object has its own isolate, so the main worker's `initLogger` is invisible
    // here — without this, every line the turn emits would come from `getLogger()`'s bare
    // fallback, stamped `environment: local` at debug level, in production. Constructor
    // rather than per-entry-point because it runs before any method.
    ensureLogger(env);
  }

  /**
   * Cache for {@link resolveFollowsTemplate}, keyed by path. Lives as long as the object: a
   * document's `templateId` is only accepted when it is created, so neither answer goes stale.
   */
  private followsTemplateByPath = new Map<string, boolean>();

  /**
   * The SDK's state protocol sends all of `state` to a connection before any message is
   * authorized. The client doesn't use it — history comes from `get_history` below.
   */
  override shouldSendProtocolMessages(_connection: Connection, _ctx: ConnectionContext): boolean {
    return false;
  }

  /**
   * The SDK applies a client's `cf_agent_state` frame before {@link onMessage} runs, so without
   * this a guessed key could rewrite `ownerId`. Readonly connections are not the lever: that
   * check also rejects this agent's own `setState`.
   */
  override validateStateChange(_nextState: AgentState, source: Connection | 'server'): void {
    if (source !== 'server') throw new Error('State updates from a client are not accepted');
  }

  /**
   * The turn currently streaming, if any. Instance state, not durable: it describes work in
   * progress, which an eviction ends anyway. `connectionId` authorizes an untokened
   * `cancel`, so only the socket that started a turn can stop it.
   */
  private activeTurn: { connectionId: string; abort: AbortController } | null = null;

  private send(connection: Connection, message: OutgoingMessage): void {
    connection.send(JSON.stringify(message));
  }

  // Gate read/clear of a conversation: the token must validate, and once the
  // conversation has an owner (set on the first chat turn) the caller must be
  // that owner. The DO key is built from non-secret ids, so the token — not the
  // key — is the access control.
  private async authorizeConversationAccess(
    token: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    let user: ValidatedUser;
    try {
      user = await validateCSSToken(token, this.env.CSS_BACKEND_URL);
    } catch (err) {
      // The client only sees the generic message, so log the cause.
      console.error(`[auth] history access denied via ${this.env.CSS_BACKEND_URL}:`, err);
      return { ok: false, error: 'Authentication failed' };
    }
    if (this.state.ownerId !== undefined && this.state.ownerId !== user.id) {
      return { ok: false, error: 'Not authorized for this conversation' };
    }
    return { ok: true };
  }

  async onMessage(connection: Connection, rawMessage: WSMessage): Promise<void> {
    if (typeof rawMessage !== 'string') {
      this.send(connection, { type: 'error', error: 'Binary messages not supported', scope: 'connection' });
      return;
    }

    // Declared before the try so the catch can reach them for cleanup.
    interface ActiveEditSession {
      siteId: string;
      branchId: string;
      documentPath: string;
      editSessionId: string;
    }
    let activeEditSession: ActiveEditSession | null = null;
    let cssApi: McpApiClient | null = null;
    let turnAbort: AbortController | null = null;
    // Stays undefined on the get_history/clear paths, which are not turn-scoped.
    let turnId: string | undefined;

    /** Send a frame stamped with this turn, so the client can attribute it. */
    const sendTurn = (message: TurnFrame): void =>
      this.send(connection, turnId === undefined ? message : { ...message, turnId });

    // One try/catch wraps the whole handler so any failure — setup or agentic loop —
    // surfaces as a structured {type:'error'} rather than an unhandled rejection.
    try {
      let parsed: IncomingMessage;
      try {
        parsed = JSON.parse(rawMessage) as IncomingMessage;
      } catch {
        this.send(connection, { type: 'error', error: 'Invalid message format', scope: 'connection' });
        return;
      }

      if (parsed.type === 'get_history') {
        // Auth: the conversation is per-user and the DO key is guessable, so require
        // a valid token whose user owns this conversation before returning history.
        const authed = await this.authorizeConversationAccess(parsed.token);
        if (!authed.ok) {
          this.send(connection, { type: 'error', error: authed.error, scope: 'connection' });
          return;
        }
        // Only replay to an established owner. If ownership isn't set yet — a brand-new
        // conversation, or legacy state persisted before ownership tracking — return
        // empty rather than risk leaking history to a non-owner with a valid token.
        const restored = this.state.ownerId === undefined
          ? []
          : buildRestoredHistory(sanitizeHistory([...this.state.conversationHistory]));
        this.send(connection, { type: 'history', history: restored });
        return;
      }

      // Stop the turn in flight. Scoped to the connection that started it, so this needs
      // no token: an attacker on a guessed key holds a different connection and so has
      // nothing to cancel. Silent when there is no matching turn (a cancel that races a
      // `done` is normal, not an error).
      if (parsed.type === 'cancel') {
        const active = this.activeTurn;
        if (active?.connectionId === connection.id) active.abort.abort();
        return;
      }

      if (parsed.type === 'clear') {
        const authed = await this.authorizeConversationAccess(parsed.token);
        if (!authed.ok) {
          this.send(connection, { type: 'error', error: authed.error, scope: 'connection' });
          return;
        }
        // Stop any turn still running: it would go on editing the page for a
        // conversation the user just wiped. The bumped clearSeq is the backstop for a
        // turn already too far along to abort cleanly.
        this.activeTurn?.abort.abort();
        await this.setState({
          conversationHistory: [],
          ownerId: this.state.ownerId,
          clearSeq: (this.state.clearSeq ?? 0) + 1,
        });
        this.send(connection, { type: 'cleared' });
        return;
      }

      if (parsed.type !== 'chat') return;

      const { message, context } = parsed;
      turnId = parsed.turnId;

      // Take ownership of the cancel channel before anything is awaited. Registering it
      // later — after the token round trip, say — meant a Stop pressed during setup found
      // no turn to cancel and was dropped, so the agent went on to edit the page seconds
      // after the user had visibly stopped it. A fresh chat frame supersedes any earlier
      // controller: the client only ever has one turn open at a time.
      const abort = new AbortController();
      turnAbort = abort;
      this.activeTurn = { connectionId: connection.id, abort };
      let cancelled = false;

      // Validate the user's CSS auth token
      let user: ValidatedUser;
      try {
        user = await validateCSSToken(context.token, this.env.CSS_BACKEND_URL);
      } catch (err) {
        // Usually CSS_BACKEND_URL pointing at a different backend than issued the token.
        console.error(
          `[auth] token validation failed against ${this.env.CSS_BACKEND_URL} ` +
            `(token ${context.token ? 'present' : 'EMPTY'}):`,
          err,
        );
        sendTurn({ type: 'error', error: 'Authentication failed' });
        return;
      }

      // Ownership: a conversation belongs to the user who started it. Reject attempts
      // to continue (or read, via model context) someone else's conversation — the DO
      // key is guessable, so the validated token is the access control here too.
      if (this.state.ownerId !== undefined && this.state.ownerId !== user.id) {
        sendTurn({ type: 'error', error: 'Not authorized for this conversation' });
        return;
      }

      // Build CSS API client acting on behalf of the validated user
      cssApi = new McpApiClient({
        baseUrl: this.env.CSS_BACKEND_URL,
        agentId: this.env.AGENT_ID,
        agentApiKey: this.env.AGENT_API_KEY,
        actingUser: { id: user.id, email: user.email, name: user.name },
      });

      // Route model calls through the Cloudflare AI Gateway REST API. The Cloudflare API
      // token authenticates (Bearer) and the gateway is selected by header, so no
      // per-provider key is needed — providers bill through the gateway's unified billing.
      // The transport picks the right endpoint from AGENT_MODEL's provider prefix
      // (anthropic/* -> /ai/v1/messages with cache_control; everything else -> /ai/v1/chat/completions).
      if (!this.env.AI_GATEWAY_ACCOUNT_ID || !this.env.AI_GATEWAY_NAME || !this.env.AI_GATEWAY_API_TOKEN) {
        sendTurn({ type: 'error', error: 'AI Gateway not configured' });
        return;
      }
      const transport = createTransport({
        accountId: this.env.AI_GATEWAY_ACCOUNT_ID,
        gatewayId: this.env.AI_GATEWAY_NAME,
        apiToken: this.env.AI_GATEWAY_API_TOKEN,
        model: this.env.AGENT_MODEL || DEFAULT_MODEL,
        tools: [...CSS_TOOLS, ...WEB_TOOLS],
      });

      // Inject page context into the user message sent to the model, but persist the raw
      // message so stored turns don't carry stale context blocks.
      const contextNote = buildContextNote(context, {
        // Skipped while a page is pending: there is no document to look up yet, and the note's
        // pending-page branch carries its own instructions.
        followsTemplate: context.pendingPage
          ? false
          : await resolveFollowsTemplate(cssApi, context, this.followsTemplateByPath),
      });
      const userContent = contextNote ? `${contextNote}\n\n${message}` : message;

      // Nothing has been done yet, so a Stop during setup just ends here.
      if (abort.signal.aborted) {
        sendTurn({ type: 'cancelled' });
        return;
      }

      // Read once the setup awaits are done, so this measures a clear landing during the
      // work itself. That is the case worth discarding a turn over: a clear before the work
      // started is simply an earlier event, and this turn belongs after it.
      const startClearSeq = this.state.clearSeq ?? 0;

      // Sanitize on load — drops malformed/legacy entries persisted before the Workers AI
      // migration so old sessions self-heal instead of crashing.
      const history = sanitizeHistory([...this.state.conversationHistory]);
      // Only this turn's own entries. They are appended to whatever is in state when the
      // turn ends, rather than rewriting a snapshot taken before it began — the model
      // streams for many seconds, and a clear or another tab's turn can commit meanwhile.
      const newEntries: ChatMessage[] = [];
      history.push({ role: 'user', content: userContent });
      newEntries.push({ role: 'user', content: message });

      // Counted in Workers Logs: a fleet still on a client that sends no write set is otherwise
      // invisible, and every such turn silently narrows to the open document.
      if (!Array.isArray(context.writeSet)) {
        console.warn('[scope] turn carried no write set; holding the agent to the open document');
      }

      // Widened as the turn creates pages, so the agent can fill in what it just made.
      let scope = context;

      // Agentic loop — keep calling the model until it stops requesting tools. The
      // transport normalizes any provider's response to OpenAI-shaped tool calls.
      while (true) {
        let completion: CompletionResult;
        try {
          completion = await transport.stream(
            {
              system: SYSTEM_PROMPT,
              messages: history,
              maxTokens: 8192,
            },
            {
              onText: delta => sendTurn({ type: 'token', content: delta }),
              onToolCallStart: call =>
                sendTurn({ type: 'tool_start', toolCallId: call.id, toolName: call.name }),
            },
            abort.signal,
          );
        } catch (err) {
          // A cancel is a user decision, not a failure: stop the loop and persist what
          // already happened rather than reporting an error over it.
          if (isAbortError(err)) {
            cancelled = true;
            break;
          }
          throw err;
        }
        const { content, toolCalls, usage } = completion;

        // Prompt-cache accounting for observability. Anthropic reports write+read;
        // native/OpenAI/Gemini report a read count only.
        if (usage && (usage.cacheReadInputTokens || usage.cacheCreationInputTokens)) {
          console.log(
            `[model] cache read=${usage.cacheReadInputTokens ?? 0} write=${usage.cacheCreationInputTokens ?? 0}`,
          );
        }

        // Carry tool_calls on the assistant message so the following tool results pair back by id.
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        };
        history.push(assistantMsg);
        newEntries.push(assistantMsg);

        if (toolCalls.length === 0) break;

        // Execute each tool call and append its result to history.
        for (const tc of toolCalls) {
          // Checked per call, not just per iteration: a batch of edits is where a turn
          // spends most of its time, and it is the work a user pressing Stop wants
          // stopped. Calls already run keep their results; the rest never start, and the
          // unanswered tool_calls are stripped when the turn is persisted.
          if (abort.signal.aborted) {
            cancelled = true;
            break;
          }
          let result: unknown;
          let isError = false;
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
            result = await executeTool(tc.function.name, input, cssApi, user.id, scope, {
              token: context.token,
              mediaWorkerUrl: this.env.MEDIA_WORKER_URL,
            });

            if (tc.function.name === 'create_page') {
              const created = createdDocumentPath(result);
              if (created !== null) scope = withCreatedPage(scope, created);
            }

            // Track edit session lifecycle for cleanup on failure
            if (tc.function.name === 'start_edit_session') {
              activeEditSession = {
                siteId: input.site_id as string,
                branchId: input.branch_id as string,
                documentPath: input.document_path as string,
                editSessionId: (result as { editSessionId: string }).editSessionId,
              };
            } else if (tc.function.name === 'complete_edit_session' || tc.function.name === 'abort_edit_session') {
              activeEditSession = null;
            }
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err) };
            isError = true;
          }

          sendTurn({
            type: 'tool_end',
            toolCallId: tc.id,
            toolName: tc.function.name,
            toolInput: input,
            toolResult: result,
          });

          // Model gets full results; storage gets trimmed results (errors kept intact).
          history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          newEntries.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(isError ? result : trimForHistory(tc.function.name, result)),
          });
        }
        if (cancelled) break;
      }

      // A cancelled turn may have left an edit session open. Closing it matters more here
      // than on the error path: the user is still working in the editor and a stale
      // session blocks their next edit.
      if (cancelled && activeEditSession && cssApi) {
        try {
          await cssApi.abortAgentEdit({ ...activeEditSession, reason: 'Cancelled by user' });
          activeEditSession = null;
        } catch {
          // Ignore cleanup failures — the cancellation itself still stands.
        }
      }

      // Persist this turn by appending it to whatever is in state NOW (keeping the last 20
      // entries to manage DO storage), and bind the conversation to the authenticated user
      // so subsequent get_history/clear calls can be authorized against this owner.
      //
      // A clear that landed while the model was streaming wins outright: rewriting state
      // from this turn would resurrect the whole conversation the user just deleted.
      if (!turnMayCommit(this.state.clearSeq, startClearSeq)) {
        console.log('[history] turn discarded: conversation was cleared while it ran');
      } else if (!turnHasOutput(newEntries)) {
        console.log('[history] turn not stored: it ended before producing a reply');
      } else {
        await this.setState({
          conversationHistory: appendTurn(this.state.conversationHistory, newEntries),
          ownerId: user.id,
          // setState replaces rather than merges, so an omitted field is a deletion. Dropping
          // clearSeq here reverted it to undefined, which the next turn read as a clear.
          clearSeq: startClearSeq,
        });
      }

      sendTurn(cancelled ? { type: 'cancelled' } : { type: 'done' });
    } catch (err) {
      // Best-effort abort any open edit session before reporting the error
      if (activeEditSession && cssApi) {
        try {
          await cssApi.abortAgentEdit({
            ...activeEditSession,
            reason: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
          });
        } catch {
          // Ignore cleanup failures — primary error takes precedence
        }
      }
      // A cancel landing between two awaits surfaces here rather than at the stream call.
      // Report it as a cancellation: the client is already showing the turn as stopped,
      // and an error toast over a deliberate Stop reads as a bug.
      if (isAbortError(err)) {
        sendTurn({ type: 'cancelled' });
        return;
      }
      const status = apiErrorStatus(err);
      const errorMessage = status === 429
        ? 'Rate limit reached — please wait a moment and try again.'
        : err instanceof Error ? err.message : 'Unknown error';
      sendTurn({ type: 'error', error: errorMessage });
    } finally {
      // Release the cancel channel, but only if it is still this turn's: a newer turn may
      // have replaced it while this one was unwinding.
      if (turnAbort && this.activeTurn?.abort === turnAbort) this.activeTurn = null;
    }
  }
}
