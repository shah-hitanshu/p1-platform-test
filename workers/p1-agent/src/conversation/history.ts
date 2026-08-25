import type OpenAI from 'openai';
import type { AttachedFileName, RestoredMessage, RestoredPart, RestoredToolCall } from '../types.js';
import { attachmentNamesOf } from './context.js';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export type StoredMessage = Msg & { attachments?: AttachedFileName[] };

/**
 * Strip the properties we added. Stored history goes straight into the next request, and a
 * strict provider rejects a message carrying anything it did not define.
 */
export function forProvider(history: StoredMessage[]): Msg[] {
  return history.map(m => {
    if (!('attachments' in m)) return m;
    const { attachments: _names, ...rest } = m;
    return rest as Msg;
  });
}

// Guard against malformed or legacy (Anthropic-shaped, array-content) entries left
// in Durable Object state from before the Workers AI migration. Anything that does
// not conform to the OpenAI message shape is dropped so old sessions self-heal
// rather than crash the request.
function isValidMessage(m: unknown): m is Msg {
  if (m === null || typeof m !== 'object') return false;
  const role = (m as { role?: unknown }).role;
  const content = (m as { content?: unknown }).content;
  switch (role) {
    case 'system':
    case 'user':
      return typeof content === 'string';
    case 'assistant':
      // We always persist assistant content as a string; tool_calls may be present.
      return content == null || typeof content === 'string';
    case 'tool':
      return typeof (m as { tool_call_id?: unknown }).tool_call_id === 'string';
    default:
      return false;
  }
}

/**
 * Pair up tool calls and their results, dropping either side of an unmatched pair — providers
 * reject history with one side missing, which a cancelled turn and trimming both cause.
 *
 * Unanswered calls are stripped from the assistant message rather than dropping it, so
 * whatever the agent already said survives.
 */
export function pairToolCalls(history: StoredMessage[]): StoredMessage[] {
  const answered = new Set<string>();
  const announced = new Set<string>();
  for (const m of history) {
    if (m.role === 'tool' && typeof m.tool_call_id === 'string') answered.add(m.tool_call_id);
    if (m.role !== 'assistant') continue;
    for (const call of toolCallsOf(m)) {
      if (typeof call.id === 'string') announced.add(call.id);
    }
  }

  const out: StoredMessage[] = [];
  for (const m of history) {
    if (m.role === 'tool') {
      // A result whose call is gone is exactly the orphan the model API rejects.
      if (typeof m.tool_call_id === 'string' && announced.has(m.tool_call_id)) out.push(m);
      continue;
    }
    if (m.role !== 'assistant') {
      out.push(m);
      continue;
    }
    const calls = toolCallsOf(m);
    if (calls.length === 0) {
      out.push(m);
      continue;
    }
    const kept = calls.filter(c => typeof c.id === 'string' && answered.has(c.id));
    if (kept.length === calls.length) {
      out.push(m);
      continue;
    }
    const { tool_calls: _dropped, ...rest } = m as Msg & { tool_calls?: unknown };
    if (kept.length > 0) {
      out.push({ ...rest, tool_calls: kept } as Msg);
    } else if (typeof rest.content === 'string' && rest.content !== '') {
      out.push(rest as Msg);
    }
  }
  return out;
}

function toolCallsOf(m: Msg): { id?: string }[] {
  const calls = (m as { tool_calls?: unknown }).tool_calls;
  return Array.isArray(calls) ? (calls as { id?: string }[]) : [];
}

// Drop any leading messages before the first user message. Tool and assistant
// messages only appear as replies, so slicing from the first user turn guarantees
// the history never starts with an orphaned tool result (a tool message with no
// preceding assistant tool_call) — which the model API rejects. Tool calls are then
// re-paired, which catches the orphans slicing leaves mid-history.
export function sanitizeHistory(history: StoredMessage[]): StoredMessage[] {
  const valid = history.filter(isValidMessage);
  const firstUserIdx = valid.findIndex(m => m.role === 'user');
  if (firstUserIdx === -1) return [];
  return pairToolCalls(firstUserIdx > 0 ? valid.slice(firstUserIdx) : valid);
}

/**
 * Exchanges kept in stored history. Counted in exchanges, not entries: one page edit is 15–25
 * entries of tool traffic, so an entry budget is spent entirely by the newest turn.
 */
export const MAX_EXCHANGES = 12;

/**
 * How many recent exchanges keep their tool traffic; older ones keep only what was said. This
 * is what bounds the stored size, and a stale tool result describes a document that has since
 * changed anyway.
 */
export const DETAILED_EXCHANGES = 3;

/**
 * Whether a turn may still commit, or was superseded by a `clear` that landed while it ran —
 * storing it would resurrect the conversation the user just deleted.
 *
 * Both sides are normalized: a conversation that has never been cleared stores no `clearSeq`,
 * so a raw comparison against a turn's `0` reports a clear that never happened.
 */
export function turnMayCommit(storedClearSeq: number | undefined, startClearSeq: number): boolean {
  return (storedClearSeq ?? 0) === startClearSeq;
}

/**
 * Whether a turn produced anything worth storing. One stopped before the model replied holds
 * only the brief, which would come back as a question with no answer.
 */
export function turnHasOutput(turn: StoredMessage[]): boolean {
  return turn.some(m => {
    if (m.role === 'tool') return true;
    if (m.role !== 'assistant') return false;
    return (typeof m.content === 'string' && m.content !== '') || toolCallsOf(m).length > 0;
  });
}

/**
 * Commit one turn's entries onto the conversation as it stands right now. `stored` must be
 * read at commit time: a turn streams for seconds, and a `clear` or another tab's turn can
 * commit in that window, so rewriting a pre-turn snapshot is a lost update.
 */
export function appendTurn(
  stored: StoredMessage[],
  turn: StoredMessage[],
  maxExchanges: number = MAX_EXCHANGES,
  detailedExchanges: number = DETAILED_EXCHANGES,
): StoredMessage[] {
  return trimHistory([...sanitizeHistory([...stored]), ...turn], maxExchanges, detailedExchanges);
}

/**
 * Bound stored history to the most recent `maxExchanges`, keeping tool traffic only for the
 * last `detailedExchanges` of them. Trims on exchange boundaries, so a turn is never cut in
 * half — and never returns empty while any user message survives.
 */
export function trimHistory(
  history: StoredMessage[],
  maxExchanges: number = MAX_EXCHANGES,
  detailedExchanges: number = DETAILED_EXCHANGES,
): StoredMessage[] {
  const exchanges = splitExchanges(sanitizeHistory(history));
  // At least one: `slice(-0)` returns the whole array, so a zero budget would keep everything.
  const kept = exchanges.slice(-Math.max(1, maxExchanges));
  const detailFrom = Math.max(0, kept.length - detailedExchanges);
  return sanitizeHistory(
    kept.flatMap((exchange, i) => (i >= detailFrom ? exchange : whatWasSaid(exchange))),
  );
}

/** Split into one group per user message: the brief and everything produced in reply. */
function splitExchanges(history: StoredMessage[]): StoredMessage[][] {
  const exchanges: StoredMessage[][] = [];
  for (const m of history) {
    if (m.role === 'user' || exchanges.length === 0) exchanges.push([m]);
    else exchanges[exchanges.length - 1].push(m);
  }
  return exchanges;
}

/** An exchange with its tool traffic dropped, leaving the brief and the replies. */
function whatWasSaid(exchange: StoredMessage[]): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const m of exchange) {
    if (m.role === 'tool') continue;
    if (m.role === 'assistant') {
      const { tool_calls: _dropped, ...rest } = m as Msg & { tool_calls?: unknown };
      if (typeof rest.content === 'string' && rest.content !== '') out.push(rest as Msg);
      continue;
    }
    out.push(m);
  }
  return out;
}

/** An assistant turn mid-assembly: both shapes are filled here, then pruned on the way out. */
type AccumulatingTurn = RestoredMessage & { parts: RestoredPart[]; toolCalls: RestoredToolCall[] };

/**
 * Collapse stored OpenAI-format history into one entry per visible chat bubble: everything
 * between two user messages merges, matching the single bubble streaming shows.
 */
export function buildRestoredHistory(history: StoredMessage[]): RestoredMessage[] {
  // Index tool results by call id so each restored tool call carries its outcome.
  const toolResults = new Map<string, unknown>();
  for (const m of history) {
    if (m.role === 'tool' && typeof m.tool_call_id === 'string') {
      let parsed: unknown = m.content;
      try { parsed = JSON.parse(m.content as string); } catch { /* keep raw string */ }
      toolResults.set(m.tool_call_id, parsed);
    }
  }

  const restored: RestoredMessage[] = [];
  let current: AccumulatingTurn | null = null;

  for (const m of history) {
    if (m.role === 'user') {
      current = null;
      const names = attachmentNamesOf(m.attachments);
      restored.push({
        role: 'user',
        content: typeof m.content === 'string' ? m.content : '',
        ...(names.length > 0 ? { attachments: names } : {}),
      });
    } else if (m.role === 'assistant') {
      if (!current) {
        current = { role: 'assistant', content: '', parts: [], toolCalls: [] };
        restored.push(current);
      }
      if (typeof m.content === 'string' && m.content) {
        current.content = current.content ? `${current.content}\n\n${m.content}` : m.content;
        current.parts.push({ type: 'text', text: m.content });
      }
      for (const tc of toolCallsOf(m)) {
        const fn = (tc as { function?: { name?: string; arguments?: string }; id?: string });
        let input: unknown = {};
        try { input = JSON.parse(fn.function?.arguments || '{}'); } catch { /* leave empty */ }
        const call: RestoredToolCall = { name: fn.function?.name ?? 'tool', input };
        if (fn.id && toolResults.has(fn.id)) call.result = toolResults.get(fn.id);
        // Both: `parts` is what the panel renders, `toolCalls` what a plugin predating it reads.
        current.parts.push({ type: 'tool', tool: call });
        current.toolCalls.push(call);
      }
    }
    // 'tool'/'system' messages are folded in above or irrelevant to replay.
  }

  // Drop turns that produced nothing, and omit the empty arrays of those that did.
  return restored
    .filter(m => m.role === 'user' || m.content || (m.toolCalls && m.toolCalls.length > 0))
    .map(m => {
      if (m.role === 'user') {
        return { role: m.role, content: m.content, ...(m.attachments ? { attachments: m.attachments } : {}) };
      }
      const out: RestoredMessage = { role: 'assistant', content: m.content };
      if (m.parts && m.parts.length > 0) out.parts = m.parts;
      if (m.toolCalls && m.toolCalls.length > 0) out.toolCalls = m.toolCalls;
      return out;
    });
}

/** Paths a stored `list_documents` keeps: enough to recall the listing, not the whole site. */
export const MAX_STORED_PATHS = 50;

/**
 * Project each entry of a tool result that is a bare array. Guarding on `Array.isArray(result)`
 * rather than reading a property off it is the point: these tools return the array itself, and
 * a projection written against a `{ items: [...] }` wrapper silently keeps everything.
 */
function projectEntries(
  result: unknown,
  project: (entry: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (!Array.isArray(result)) return result;
  return result.map(entry =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? project(entry as Record<string, unknown>)
      : entry);
}

export function trimForHistory(toolName: string, result: unknown): unknown {
  if (result === null || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;

  switch (toolName) {
    case 'get_document':
      // Drop the full snapshot: tens of thousands of tokens, and stale by the next turn.
      return { documentPath: r.documentPath };

    case 'apply_document_edits':
      return {
        success: r.success,
        operationsApplied: r.operationsApplied,
        ...(r.error !== undefined ? { error: r.error } : {}),
      };

    case 'list_components':
      // `defaultProps` is the bulk of it, and the agent has to re-read the registry before
      // editing anyway — the stored entry only has to say the lookup happened.
      return projectEntries(result, c => ({ name: c.name }));

    case 'list_page_templates':
      return projectEntries(result, t => ({ id: t.id, label: t.label ?? t.name }));

    case 'list_media':
      return projectEntries(result, m => ({ filename: m.filename }));

    case 'list_documents': {
      const documents = r.documents;
      if (!Array.isArray(documents) || documents.length <= MAX_STORED_PATHS) return result;
      return {
        documents: documents.slice(0, MAX_STORED_PATHS),
        omitted: documents.length - MAX_STORED_PATHS,
      };
    }

    default:
      return result;
  }
}
