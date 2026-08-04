import type { ChatMessage, MessagePart, TextPart, ToolCallStatus } from './types.js';

/** Reading and grouping helpers for a turn's ordered {@link MessagePart} sequence. */

/**
 * The turn's parts. The fallback covers a Worker predating them, which recorded no position —
 * so that shape can only flatten to all prose then all calls.
 */
export function messageParts(message: ChatMessage): MessagePart[] {
  if (message.parts) return message.parts;

  const parts: MessagePart[] = [];
  if (message.content !== '') {
    parts.push({ type: 'text', id: `${message.id}-legacy-text`, text: message.content });
  }
  for (const tool of message.toolCalls ?? []) {
    parts.push({ type: 'tool', tool });
  }
  return parts;
}

/** One block of a turn, in the order it happened. */
export type TurnBlock =
  /** A prose run. Its own block, so text either side of a call isn't fused into one paragraph. */
  | TextPart
  /** A run of adjacent calls, grouped so a batch reads as one step list rather than several. */
  | { type: 'tools'; id: string; tools: ToolCallStatus[] };

/**
 * A turn's parts grouped for display, in the order they happened. Adjacent calls merge into one
 * block; empty text parts are dropped, since providers emit a blank one either side of a call.
 */
export function turnBlocks(parts: MessagePart[]): TurnBlock[] {
  const blocks: TurnBlock[] = [];

  for (const part of parts) {
    if (part.type === 'tool') {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'tools') last.tools.push(part.tool);
      // Positional id: parts only ever append, so this stays stable as the run grows.
      else blocks.push({ type: 'tools', id: `tools-${blocks.length}`, tools: [part.tool] });
      continue;
    }
    if (part.text.trim() === '') continue;
    blocks.push({ type: 'text', id: part.id, text: part.text });
  }

  return blocks;
}

/**
 * The agent is busy with nothing on screen to show it: before its first output, or in the pause
 * after a call returns. Prose as the last block is excluded — a finished run of it can't be told
 * from one still streaming, so the alternative is a spinner under every reply.
 */
export function isAwaitingModel(blocks: TurnBlock[]): boolean {
  if (blocks[blocks.length - 1]?.type === 'text') return false;
  return !blocks.some(block => block.type === 'tools' && block.tools.some(t => t.status === 'running'));
}

/**
 * The step to name when describing a turn in one line. The first in-flight call: the agent
 * runs a batch in announcement order, so the rest are queued behind it.
 */
export function activeStep(message: ChatMessage): ToolCallStatus | undefined {
  for (const part of messageParts(message)) {
    if (part.type === 'tool' && part.tool.status === 'running') return part.tool;
  }
  return undefined;
}
