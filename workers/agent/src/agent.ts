import { Agent } from 'agents';
import type { Connection, WSMessage } from 'agents';
import OpenAI from 'openai';
import type { Env, IncomingMessage, OutgoingMessage, ChatContext, ValidatedUser } from './types.js';
import { McpApiClient } from './css-api.js';
import { CSS_TOOLS, WEB_TOOLS, executeTool } from './tools.js';
import { validateCSSToken } from './auth.js';
import { trimHistory, sanitizeHistory, trimForHistory, buildRestoredHistory } from './history.js';

// Model reached through the AI Gateway compat endpoint, in provider/model notation
// (workers-ai/@cf/... for native Cloudflare models, anthropic/... for Claude).
// Override per environment via AGENT_MODEL.
const DEFAULT_MODEL = 'workers-ai/@cf/moonshotai/kimi-k2.7-code';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface AgentState {
  conversationHistory: ChatMessage[];
  // The validated user who owns this conversation, established on the first
  // authenticated chat turn. get_history/clear require the caller's token to
  // resolve to this id — the DO key is built from non-secret, guessable ids, so
  // ownership can't rely on the key alone.
  ownerId?: string;
}

const SYSTEM_PROMPT = `You are an AI assistant integrated into a P1 page editor.
You help users build and edit web pages using the Collaborative State System (CSS).

## Context you always have
Every user message includes an editor context block with the current site ID, branch ID, and document path. Use these values directly — never call any tool to discover, list, or search for sites, branches, or documents. That information is already provided.

Document paths do not have a leading slash (e.g. "new-from-sageview", not "/new-from-sageview"). Use the path exactly as provided in the editor context.

## Default scope
All requests apply to the current document in the editor context unless the user explicitly names a different page, site, or branch.

## Create vs. edit — always confirm when ambiguous
When a request could mean either editing the current page or creating a new one (e.g. "make a page about X", "build a page for X"), you MUST ask the user to clarify before taking any action:

> "Do you want to update the current page to be about X, or create a new page at a different path?"

Only proceed without asking when the intent is unambiguous:
- Clear edit signals: "update this", "change the title", "add a section to this page", "modify the hero"
- Clear create signals: "create a new page at /path", "add a page called /about", "make a new page"

When in doubt, ask.

## When to call get_document
Call get_document whenever you need the current page structure and haven't already fetched it **in the current turn**. The full snapshot is not retained across turns — history only records that a fetch occurred, not its content — so prior turns tell you nothing about the current document state. Skip it only when:
- You already called get_document earlier in this same turn and the document hasn't been modified since
- The user is asking a general question that requires no structural knowledge

## When to call list_components
Only when creating a brand-new page that the user has confirmed they want. Do not call it when editing an existing page.

## Workflow for editing the current page
1. check_edit_permission — verify you can edit
2. get_document — only if you need the current structure and don't already have it
3. start_edit_session to reserve regions
4. apply_document_edits with your changes
5. complete_edit_session when done (or abort_edit_session on error)

## Workflow for creating a new page (only after user confirms)
1. list_components to see available components
2. create_page with the chosen components and content

## General guidance
- Use dot-notation paths for edits: "content.0.props.title" not "content[0].props.title"
- Always complete or abort edit sessions — never leave them open
- **Prop field names must exactly match the component schema.** Never guess, invent, or rename prop keys.
  - When editing an existing component: copy field names verbatim from the \`get_document\` snapshot.
  - When adding a new component: use only the keys present in \`defaultProps\` from \`list_components\`.
  - If you are uncertain about a component's field names, call \`list_components\` before editing.
  - The backend will reject any prop key that does not exist in the component schema.

## Moving or reordering components
To move a single component to a different position, use the \`move\` operation — it is one atomic step:

\`\`\`json
{ "type": "move", "path": "content", "fromIndex": 0, "toIndex": 3 }
\`\`\`

This moves the component at index 0 to index 3 in the \`content\` array.

For complex reorders involving many components at once, call \`get_document\`, compute the full reordered array, and apply a single \`replace\` on the \`content\` path with the new array.

Never use \`remove\` followed by \`add\` to reposition a component — array indices shift after a removal and the result will be wrong.

## Additional tools

### fetch_page
- Use when the user asks to reference, analyze, or recreate an existing public web page
- Do not use unless the user provides or asks about a specific URL
- After fetching, summarize what you found before proposing any edits

### list_media
- Use when the user asks about available images or wants to add an image to the page
- Always use the \`site_id\` from the editor context
- When selecting an image for a page component, show the user the filename and URL and confirm before using it — unless the filename makes the content unambiguous (e.g., \`logo.png\`, \`hero-banner.jpg\`)
- If \`search\` is provided, it filters by filename substring (case-insensitive)`;

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

      // Route model calls through the AI Gateway's OpenAI-compatible endpoint; the
      // gateway token authenticates the request, so no per-provider key is needed.
      if (!this.env.AI_GATEWAY_ACCOUNT_ID || !this.env.AI_GATEWAY_NAME || !this.env.CF_AIG_TOKEN) {
        this.send(connection, { type: 'error', error: 'AI Gateway not configured' });
        return;
      }
      const ai = new OpenAI({
        apiKey: this.env.CF_AIG_TOKEN,
        baseURL: `https://gateway.ai.cloudflare.com/v1/${this.env.AI_GATEWAY_ACCOUNT_ID}/${this.env.AI_GATEWAY_NAME}/compat`,
      });
      const model = this.env.AGENT_MODEL || DEFAULT_MODEL;
      const tools = [...CSS_TOOLS, ...WEB_TOOLS];

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

      // Agentic loop — keep calling the model until it stops requesting tools.
      while (true) {
        const completion = await ai.chat.completions.create({
          model,
          max_tokens: 8192,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
          tools,
          tool_choice: 'auto',
        });

        const choice = completion.choices[0]?.message;
        if (!choice) throw new Error('Model returned no choices');

        type FnToolCall = Extract<
          OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
          { type: 'function' }
        >;
        const toolCalls = (choice.tool_calls ?? []).filter(
          (tc): tc is FnToolCall => tc.type === 'function',
        );

        // Stream assistant text and tool starts to the client
        if (choice.content) this.send(connection, { type: 'token', content: choice.content });
        for (const tc of toolCalls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments || '{}'); } catch { /* reported on execute */ }
          this.send(connection, { type: 'tool_start', toolName: tc.function.name, toolInput: input });
        }

        // Carry tool_calls on the assistant message so the following tool results pair back by id.
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: choice.content ?? '',
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
      const status = err instanceof OpenAI.APIError ? err.status : undefined;
      const errorMessage = status === 429
        ? 'Rate limit reached — please wait a moment and try again.'
        : err instanceof Error ? err.message : 'Unknown error';
      this.send(connection, { type: 'error', error: errorMessage });
    }
  }
}

function buildContextNote(context: ChatContext): string {
  const isExisting = !!(context.documentId || context.puckData);
  const header = isExisting
    ? '[Current editor context — existing document]'
    : '[Current editor context]';
  const lines: string[] = [header];
  if (context.siteId) lines.push(`Site ID: ${context.siteId}`);
  if (context.branchId) lines.push(`Branch ID: ${context.branchId}`);
  if (context.documentPath) lines.push(`Document: ${context.documentPath}`);
  if (isExisting) {
    lines.push('This document already exists. Use the edit workflow unless the user explicitly asks to create a new page.');
  }
  return lines.length > 1 ? lines.join('\n') : '';
}
