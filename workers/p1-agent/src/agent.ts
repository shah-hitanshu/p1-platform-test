import { Agent } from 'agents';
import type { Connection, WSMessage } from 'agents';
import type { Env, IncomingMessage, OutgoingMessage, ValidatedUser } from './types.js';
import { McpApiClient } from './css-api.js';
import { CSS_TOOLS, WEB_TOOLS, executeTool } from './tools.js';
import { validateCSSToken } from './auth.js';
import { trimHistory, sanitizeHistory, trimForHistory, buildRestoredHistory } from './history.js';
import { createTransport, apiErrorStatus, type ChatMessage } from './model.js';
import { SYSTEM_PROMPT, buildContextNote } from './prompt.js';

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
}

export class ChatAgent extends Agent<Env, AgentState> {
  initialState: AgentState = { conversationHistory: [] };

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
    } catch {
      return { ok: false, error: 'Authentication failed' };
    }
    if (this.state.ownerId !== undefined && this.state.ownerId !== user.id) {
      return { ok: false, error: 'Not authorized for this conversation' };
    }
    return { ok: true };
  }

  async onMessage(connection: Connection, rawMessage: WSMessage): Promise<void> {
    if (typeof rawMessage !== 'string') {
      this.send(connection, { type: 'error', error: 'Binary messages not supported' });
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

    // One try/catch wraps the whole handler so any failure — setup or agentic loop —
    // surfaces as a structured {type:'error'} rather than an unhandled rejection.
    try {
      let parsed: IncomingMessage;
      try {
        parsed = JSON.parse(rawMessage) as IncomingMessage;
      } catch {
        this.send(connection, { type: 'error', error: 'Invalid message format' });
        return;
      }

      if (parsed.type === 'get_history') {
        // Auth: the conversation is per-user and the DO key is guessable, so require
        // a valid token whose user owns this conversation before returning history.
        const authed = await this.authorizeConversationAccess(parsed.token);
        if (!authed.ok) {
          this.send(connection, { type: 'error', error: authed.error });
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

      if (parsed.type === 'clear') {
        const authed = await this.authorizeConversationAccess(parsed.token);
        if (!authed.ok) {
          this.send(connection, { type: 'error', error: authed.error });
          return;
        }
        await this.setState({ conversationHistory: [], ownerId: this.state.ownerId });
        this.send(connection, { type: 'cleared' });
        return;
      }

      if (parsed.type !== 'chat') return;

      const { message, context } = parsed;

      // Validate the user's CSS auth token
      let user: ValidatedUser;
      try {
        user = await validateCSSToken(context.token, this.env.CSS_BACKEND_URL);
      } catch {
        this.send(connection, { type: 'error', error: 'Authentication failed' });
        return;
      }

      // Ownership: a conversation belongs to the user who started it. Reject attempts
      // to continue (or read, via model context) someone else's conversation — the DO
      // key is guessable, so the validated token is the access control here too.
      if (this.state.ownerId !== undefined && this.state.ownerId !== user.id) {
        this.send(connection, { type: 'error', error: 'Not authorized for this conversation' });
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
        this.send(connection, { type: 'error', error: 'AI Gateway not configured' });
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
      const contextNote = buildContextNote(context);
      const userContent = contextNote ? `${contextNote}\n\n${message}` : message;

      // Sanitize on load — drops malformed/legacy entries persisted before the Workers AI
      // migration so old sessions self-heal instead of crashing.
      const history = sanitizeHistory([...this.state.conversationHistory]);
      const historyForStorage = [...history];
      history.push({ role: 'user', content: userContent });
      historyForStorage.push({ role: 'user', content: message });

      // Agentic loop — keep calling the model until it stops requesting tools. The
      // transport normalizes any provider's response to OpenAI-shaped tool calls.
      while (true) {
        const { content, toolCalls, usage } = await transport.complete({
          system: SYSTEM_PROMPT,
          messages: history,
          maxTokens: 8192,
        });

        // Prompt-cache accounting for observability. Anthropic reports write+read;
        // native/OpenAI/Gemini report a read count only.
        if (usage && (usage.cacheReadInputTokens || usage.cacheCreationInputTokens)) {
          console.log(
            `[model] cache read=${usage.cacheReadInputTokens ?? 0} write=${usage.cacheCreationInputTokens ?? 0}`,
          );
        }

        // Stream assistant text and tool starts to the client
        if (content) this.send(connection, { type: 'token', content });
        for (const tc of toolCalls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments || '{}'); } catch { /* reported on execute */ }
          this.send(connection, { type: 'tool_start', toolName: tc.function.name, toolInput: input });
        }

        // Carry tool_calls on the assistant message so the following tool results pair back by id.
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        };
        history.push(assistantMsg);
        historyForStorage.push(assistantMsg);

        if (toolCalls.length === 0) break;

        // Execute each tool call and append its result to history.
        for (const tc of toolCalls) {
          let result: unknown;
          let isError = false;
          try {
            const input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
            result = await executeTool(tc.function.name, input, cssApi, user.id, {
              token: context.token,
              mediaWorkerUrl: this.env.MEDIA_WORKER_URL,
            });

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

          this.send(connection, { type: 'tool_end', toolName: tc.function.name, toolResult: result });

          // Model gets full results; storage gets trimmed results (errors kept intact).
          history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          historyForStorage.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(isError ? result : trimForHistory(tc.function.name, result)),
          });
        }
      }

      // Persist updated history (keep last 20 entries to manage DO storage)
      // Persist history and bind the conversation to the authenticated user so
      // subsequent get_history/clear calls can be authorized against this owner.
      await this.setState({
        conversationHistory: trimHistory(historyForStorage, 20),
        ownerId: user.id,
      });

      this.send(connection, { type: 'done' });
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
      const status = apiErrorStatus(err);
      const errorMessage = status === 429
        ? 'Rate limit reached — please wait a moment and try again.'
        : err instanceof Error ? err.message : 'Unknown error';
      this.send(connection, { type: 'error', error: errorMessage });
    }
  }
}
