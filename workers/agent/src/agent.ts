import { Agent } from 'agents';
import type { Connection, WSMessage } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env, IncomingMessage, OutgoingMessage, ChatContext } from './types.js';
import { McpApiClient } from './css-api.js';
import { CSS_TOOLS, executeTool } from './tools.js';
import { validateCSSToken } from './auth.js';
import { trimHistory, sanitizeHistory, trimForHistory } from './history.js';

interface AgentState {
  conversationHistory: Anthropic.MessageParam[];
}

const SYSTEM_PROMPT = `You are an AI assistant integrated into a Puck page editor.
You help users build and edit web pages using the Collaborative State System (CSS).

## Context you always have
Every user message includes an editor context block with the current site ID, branch ID, and document path. Use these values directly — never call any tool to discover, list, or search for sites, branches, or documents. That information is already provided.

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
- Always complete or abort edit sessions — never leave them open`;

export class ChatAgent extends Agent<Env, AgentState> {
  initialState: AgentState = { conversationHistory: [] };

  private send(connection: Connection, message: OutgoingMessage): void {
    connection.send(JSON.stringify(message));
  }

  async onMessage(connection: Connection, rawMessage: WSMessage): Promise<void> {
    if (typeof rawMessage !== 'string') {
      this.send(connection, { type: 'error', error: 'Binary messages not supported' });
      return;
    }

    let parsed: IncomingMessage;
    try {
      parsed = JSON.parse(rawMessage) as IncomingMessage;
    } catch {
      this.send(connection, { type: 'error', error: 'Invalid message format' });
      return;
    }

    if (parsed.type !== 'chat') return;

    const { message, context } = parsed;

    // Validate the user's CSS auth token
    let user: { id: string; email: string };
    try {
      user = await validateCSSToken(context.token, this.env.CSS_BACKEND_URL);
    } catch {
      this.send(connection, { type: 'error', error: 'Authentication failed' });
      return;
    }

    // Build CSS API client acting on behalf of the validated user
    const cssApi = new McpApiClient({
      baseUrl: this.env.CSS_BACKEND_URL,
      agentId: this.env.AGENT_ID,
      agentApiKey: this.env.AGENT_API_KEY,
      actingUser: { id: user.id, email: user.email },
    });

    // Build Anthropic client — route via Cloudflare AI Gateway if configured, else call Anthropic directly
    const gatewayBaseURL =
      this.env.AI_GATEWAY_ACCOUNT_ID && this.env.AI_GATEWAY_NAME
        ? `https://gateway.ai.cloudflare.com/v1/${this.env.AI_GATEWAY_ACCOUNT_ID}/${this.env.AI_GATEWAY_NAME}/anthropic`
        : undefined;
    const anthropic = new Anthropic({
      apiKey: this.env.ANTHROPIC_API_KEY,
      ...(gatewayBaseURL ? { baseURL: gatewayBaseURL } : {}),
      ...(gatewayBaseURL && this.env.CF_AIG_TOKEN
        ? { defaultHeaders: { 'cf-aig-authorization': `Bearer ${this.env.CF_AIG_TOKEN}` } }
        : {}),
    });

    // Inject page context into the user message
    const contextNote = buildContextNote(context);
    const userContent = contextNote ? `${contextNote}\n\n${message}` : message;

    // Sanitize on load — fixes any bad state persisted before this fix was deployed.
    // Store raw message without context note; context is injected into the first
    // API call only so historical turns don't carry stale context blocks.
    const history = sanitizeHistory([...this.state.conversationHistory]);
    const historyForStorage = [...history];
    history.push({ role: 'user', content: message });
    historyForStorage.push({ role: 'user', content: message });

    // Agentic loop — keep calling Claude until no more tool use
    let assistantContent: Anthropic.ContentBlock[] = [];

    // Track any open edit session so we can abort it on unexpected errors
    interface ActiveEditSession {
      siteId: string;
      branchId: string;
      documentPath: string;
      editSessionId: string;
    }
    let activeEditSession: ActiveEditSession | null = null;

    // Index of the last stable (pre-turn) message in history. Captured once so
    // the cache breakpoint stays fixed as history grows during the loop.
    const stableHistoryLastIdx = history.length - 2; // -1 for current user msg, -1 for 0-based

    // Tracks the last tool-result message added within this turn. Updated after
    // each tool exchange so the 4th cache slot covers completed within-turn
    // exchanges (notably the large get_document snapshot) on subsequent calls.
    let turnCacheBreakpointIdx = -1;

    const userMsgIdx = stableHistoryLastIdx + 1;
    try {
      while (true) {
        // Always inject the current page context into the user message position so
        // the agent retains its document anchor even after tool failures in the loop.
        const baseMessages: Anthropic.MessageParam[] = contextNote
          ? [
              ...history.slice(0, userMsgIdx),
              { role: 'user' as const, content: userContent },
              ...history.slice(userMsgIdx + 1),
            ]
          : history;
        // Slot 3: cache everything up to the last pre-turn message.
        // Slot 4: cache everything up to the last completed within-turn exchange
        //         (covers the get_document snapshot on calls 3–N of the loop).
        const apiMessages = withCacheBreakpoint(
          withCacheBreakpoint(baseMessages, stableHistoryLastIdx),
          turnCacheBreakpointIdx,
        );
        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8192,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: apiMessages,
          tools: [
            ...CSS_TOOLS.slice(0, -1),
            { ...CSS_TOOLS[CSS_TOOLS.length - 1], cache_control: { type: 'ephemeral' } },
          ],
        });

        assistantContent = response.content;

        // Stream text blocks and tool starts to the client
        for (const block of response.content) {
          if (block.type === 'text') {
            this.send(connection, { type: 'token', content: block.text });
          } else if (block.type === 'tool_use') {
            this.send(connection, { type: 'tool_start', toolName: block.name, toolInput: block.input });
          }
        }

        if (response.stop_reason !== 'tool_use') break;

        // Execute tool calls and collect results
        const toolResultsFull: Anthropic.ToolResultBlockParam[] = [];
        const toolResultsTrimmed: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          let result: unknown;
          let isError = false;
          try {
            result = await executeTool(block.name, block.input as Record<string, unknown>, cssApi, user.id, { documentId: context.documentId });

            // Track edit session lifecycle for cleanup on failure
            const input = block.input as Record<string, unknown>;
            if (block.name === 'start_edit_session' && !isError) {
              activeEditSession = {
                siteId: input.site_id as string,
                branchId: input.branch_id as string,
                documentPath: input.document_path as string,
                editSessionId: (result as { editSessionId: string }).editSessionId,
              };
            } else if (block.name === 'complete_edit_session' || block.name === 'abort_edit_session') {
              activeEditSession = null;
            }
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err) };
            isError = true;
          }

          this.send(connection, { type: 'tool_end', toolName: block.name, toolResult: result });

          const base = {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            ...(isError ? { is_error: true } : {}),
          };
          toolResultsFull.push({ ...base, content: JSON.stringify(result) });
          toolResultsTrimmed.push({ ...base, content: JSON.stringify(trimForHistory(block.name, result)) });
        }

        // Claude gets full results; storage gets trimmed results
        history.push({ role: 'assistant', content: assistantContent });
        history.push({ role: 'user', content: toolResultsFull });
        // Advance the within-turn cache breakpoint to the tool results just added
        // so the next iteration caches all completed exchanges (including any
        // large get_document snapshot from earlier in this turn).
        turnCacheBreakpointIdx = history.length - 1;

        historyForStorage.push({ role: 'assistant', content: assistantContent });
        historyForStorage.push({ role: 'user', content: toolResultsTrimmed });
      }

      // Persist updated history (keep last 20 turns to manage DO storage)
      historyForStorage.push({ role: 'assistant', content: assistantContent });
      await this.setState({ conversationHistory: trimHistory(historyForStorage, 20) });

      this.send(connection, { type: 'done' });
    } catch (err) {
      // Best-effort abort any open edit session before reporting the error
      if (activeEditSession) {
        try {
          await cssApi.abortAgentEdit({
            ...activeEditSession,
            reason: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
          });
        } catch {
          // Ignore cleanup failures — primary error takes precedence
        }
      }
      const errorMessage = err instanceof Anthropic.RateLimitError
        ? 'Rate limit reached — please wait a moment and try again.'
        : err instanceof Error ? err.message : 'Unknown error';
      this.send(connection, { type: 'error', error: errorMessage });
    }
  }
}

// Add an Anthropic prompt-cache breakpoint to the last content block of the
// message at `index`. Everything up to and including that block is eligible
// for caching on subsequent API calls within the same agentic turn.
function withCacheBreakpoint(messages: Anthropic.MessageParam[], index: number): Anthropic.MessageParam[] {
  if (index < 0 || index >= messages.length) return messages;
  const msg = messages[index];
  const content = msg.content;
  const cc = { type: 'ephemeral' as const };
  let marked: Anthropic.MessageParam['content'];
  if (typeof content === 'string') {
    marked = [{ type: 'text', text: content, cache_control: cc }];
  } else if (Array.isArray(content) && content.length > 0) {
    const last = { ...(content[content.length - 1] as object), cache_control: cc };
    marked = [...content.slice(0, -1), last] as unknown as Anthropic.MessageParam['content'];
  } else {
    return messages;
  }
  return [...messages.slice(0, index), { ...msg, content: marked }, ...messages.slice(index + 1)];
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
