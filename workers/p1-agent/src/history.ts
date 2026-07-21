import type OpenAI from 'openai';
import type { RestoredMessage, RestoredToolCall } from './types.js';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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

// Drop any leading messages before the first user message. Tool and assistant
// messages only appear as replies, so slicing from the first user turn guarantees
// the history never starts with an orphaned tool result (a tool message with no
// preceding assistant tool_call) — which the model API rejects.
export function sanitizeHistory(history: Msg[]): Msg[] {
  const valid = history.filter(isValidMessage);
  const firstUserIdx = valid.findIndex(m => m.role === 'user');
  if (firstUserIdx === -1) return [];
  return firstUserIdx > 0 ? valid.slice(firstUserIdx) : valid;
}

// Trim history to maxLength entries, sanitizing both before and after slicing so the
// result never starts with an orphaned tool result.
export function trimHistory(history: Msg[], maxLength: number): Msg[] {
  const sanitized = sanitizeHistory(history);
  if (sanitized.length <= maxLength) return sanitized;
  return sanitizeHistory(sanitized.slice(-maxLength));
}

/**
 * Collapse stored OpenAI-format history into one entry per visible chat bubble.
 * Streaming shows a single assistant bubble per user turn that accumulates text
 * and tool badges across every agentic-loop iteration; replay must match, so all
 * assistant + tool messages between two user messages merge into one entry.
 */
export function buildRestoredHistory(history: Msg[]): RestoredMessage[] {
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
  let currentAssistant: RestoredMessage | null = null;

  for (const m of history) {
    if (m.role === 'user') {
      currentAssistant = null;
      restored.push({ role: 'user', content: typeof m.content === 'string' ? m.content : '' });
    } else if (m.role === 'assistant') {
      if (!currentAssistant) {
        currentAssistant = { role: 'assistant', content: '', toolCalls: [] };
        restored.push(currentAssistant);
      }
      if (typeof m.content === 'string' && m.content) {
        currentAssistant.content = currentAssistant.content
          ? `${currentAssistant.content}\n\n${m.content}`
          : m.content;
      }
      const toolCalls = (m as { tool_calls?: unknown[] }).tool_calls ?? [];
      for (const tc of toolCalls) {
        const fn = (tc as { function?: { name?: string; arguments?: string }; id?: string });
        let input: unknown = {};
        try { input = JSON.parse(fn.function?.arguments || '{}'); } catch { /* leave empty */ }
        const call: RestoredToolCall = { name: fn.function?.name ?? 'tool', input };
        if (fn.id && toolResults.has(fn.id)) call.result = toolResults.get(fn.id);
        currentAssistant.toolCalls!.push(call);
      }
    }
    // 'tool'/'system' messages are folded in above or irrelevant to replay.
  }

  // Drop empty assistant entries and empty toolCalls arrays for a clean transcript.
  return restored
    .filter(m => m.role === 'user' || m.content || (m.toolCalls && m.toolCalls.length > 0))
    .map(m =>
      m.role === 'assistant' && (!m.toolCalls || m.toolCalls.length === 0)
        ? { role: m.role, content: m.content }
        : m,
    );
}

export function trimForHistory(toolName: string, result: unknown): unknown {
  if (result === null || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;

  switch (toolName) {
    case 'get_document':
      // Drop the full snapshot — it can be tens of thousands of tokens and the
      // model already used it to plan edits. Keeping only the identity fields
      // prevents it from being re-sent on every subsequent tool-call iteration.
      return { documentId: r.documentId, versionNumber: r.versionNumber };

    case 'apply_document_edits':
      return {
        success: r.success,
        operationsApplied: r.operationsApplied,
        ...(r.error !== undefined ? { error: r.error } : {}),
      };

    case 'list_components': {
      if (!Array.isArray(r.components)) return r;
      return {
        ...r,
        components: (r.components as Record<string, unknown>[]).map(c => ({
          name: c.name,
          description: c.description,
        })),
      };
    }

    default:
      return result;
  }
}
