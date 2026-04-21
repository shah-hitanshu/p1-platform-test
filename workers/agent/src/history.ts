import type Anthropic from '@anthropic-ai/sdk';

// Remove any leading messages before the first clean user message (non-tool_result-only)
// to prevent orphaned tool_result blocks that have no matching tool_use.
export function sanitizeHistory(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const firstCleanIdx = history.findIndex(m => {
    if (m.role !== 'user') return false;
    if (typeof m.content === 'string') return true;
    if (Array.isArray(m.content)) {
      return m.content.some(b => (b as { type: string }).type !== 'tool_result');
    }
    return false;
  });
  if (firstCleanIdx === -1) return [];
  return firstCleanIdx > 0 ? history.slice(firstCleanIdx) : history;
}

// Trim history to maxLength entries, sanitizing both before and after slicing
// so the result never starts with orphaned tool_result blocks.
export function trimHistory(history: Anthropic.MessageParam[], maxLength: number): Anthropic.MessageParam[] {
  const sanitized = sanitizeHistory(history);
  if (sanitized.length <= maxLength) return sanitized;
  return sanitizeHistory(sanitized.slice(-maxLength));
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
