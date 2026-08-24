import { describe, it, expect } from 'vitest';
import { messageParts, turnBlocks, isAwaitingModel, activeStep } from '../src/lib/transcript/messageParts.js';
import type { ChatMessage, MessagePart, ToolCallStatus } from '../src/types.js';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  content: '',
  ...over,
});

const tool = (over: Partial<ToolCallStatus> = {}): ToolCallStatus => ({
  name: 'get_document',
  status: 'done',
  ...over,
});

describe('messageParts', () => {
  it('returns the ordered parts when the turn has them', () => {
    const parts: MessagePart[] = [
      { type: 'text', id: 't1', text: 'before' },
      { type: 'tool', tool: tool() },
      { type: 'text', id: 't2', text: 'after' },
    ];
    expect(messageParts(msg({ parts, content: 'beforeafter' }))).toEqual(parts);
  });

  it('upcasts a replayed turn into text-then-tools', () => {
    const t = tool({ name: 'apply_document_edits' });
    expect(messageParts(msg({ content: 'Done.', toolCalls: [t] }))).toEqual([
      { type: 'text', id: 'm1-legacy-text', text: 'Done.' },
      { type: 'tool', tool: t },
    ]);
  });

  it('omits the text part when a replayed turn is only tool calls', () => {
    const t = tool();
    expect(messageParts(msg({ content: '', toolCalls: [t] }))).toEqual([{ type: 'tool', tool: t }]);
  });

  it('returns nothing for an empty turn rather than a blank text part', () => {
    expect(messageParts(msg())).toEqual([]);
  });

  it('prefers parts over the legacy fields when both are present', () => {
    const parts: MessagePart[] = [{ type: 'text', id: 't1', text: 'from parts' }];
    expect(messageParts(msg({ parts, content: 'from content', toolCalls: [tool()] }))).toEqual(parts);
  });
});

describe('turnBlocks', () => {
  it('keeps prose and calls in the order they happened', () => {
    const a = tool({ name: 'get_document' });
    const b = tool({ name: 'apply_document_edits' });
    const blocks = turnBlocks([
      { type: 'text', id: 't1', text: 'Reading first.' },
      { type: 'tool', tool: a },
      { type: 'text', id: 't2', text: 'Now editing.' },
      { type: 'tool', tool: b },
    ]);

    expect(blocks).toEqual([
      { type: 'text', id: 't1', text: 'Reading first.' },
      { type: 'tools', id: 'tools-1', tools: [a] },
      { type: 'text', id: 't2', text: 'Now editing.' },
      { type: 'tools', id: 'tools-3', tools: [b] },
    ]);
  });

  it('merges adjacent calls into one block, whatever their status', () => {
    const done = tool({ id: 'c1', name: 'get_document' });
    const running = tool({ id: 'c2', name: 'apply_document_edits', status: 'running' });
    const blocks = turnBlocks([{ type: 'tool', tool: done }, { type: 'tool', tool: running }]);

    expect(blocks).toEqual([{ type: 'tools', id: 'tools-0', tools: [done, running] }]);
  });

  it('starts a new block when prose separates two calls', () => {
    const a = tool({ id: 'c1' });
    const b = tool({ id: 'c2', name: 'list_components' });
    const blocks = turnBlocks([
      { type: 'tool', tool: a },
      { type: 'text', id: 't1', text: 'between' },
      { type: 'tool', tool: b },
    ]);

    expect(blocks.map(b => b.type)).toEqual(['tools', 'text', 'tools']);
  });

  // Blank prose is dropped, and must not split a run that was really contiguous.
  it('drops empty prose without breaking the run around it', () => {
    const a = tool({ id: 'c1' });
    const b = tool({ id: 'c2', name: 'list_components' });
    const blocks = turnBlocks([
      { type: 'tool', tool: a },
      { type: 'text', id: 't1', text: '   \n ' },
      { type: 'tool', tool: b },
    ]);

    expect(blocks).toEqual([{ type: 'tools', id: 'tools-0', tools: [a, b] }]);
  });

  it('drops empty and whitespace-only prose, which would render as blank paragraphs', () => {
    const blocks = turnBlocks([
      { type: 'text', id: 't1', text: '' },
      { type: 'text', id: 't2', text: '   \n ' },
      { type: 'text', id: 't3', text: 'real' },
    ]);

    expect(blocks).toEqual([{ type: 'text', id: 't3', text: 'real' }]);
  });

  it('returns nothing for no parts', () => {
    expect(turnBlocks([])).toEqual([]);
  });
});

describe('isAwaitingModel', () => {
  it('is true before the turn has produced anything', () => {
    expect(isAwaitingModel([])).toBe(true);
  });

  it('is true in the pause after a run finishes', () => {
    expect(isAwaitingModel(turnBlocks([{ type: 'tool', tool: tool() }]))).toBe(true);
  });

  it('is false while a call is in flight, which shows its own row', () => {
    const running = turnBlocks([{ type: 'tool', tool: tool({ status: 'running' }) }]);
    expect(isAwaitingModel(running)).toBe(false);
  });

  it('is false while prose is the last block, since text landing is its own signal', () => {
    const blocks = turnBlocks([
      { type: 'tool', tool: tool() },
      { type: 'text', id: 't1', text: 'Here is what I found.' },
    ]);
    expect(isAwaitingModel(blocks)).toBe(false);
  });

  // Defensive: the scan covers every block, not just the last one.
  it('is false when a call in an earlier run is still in flight', () => {
    const blocks = turnBlocks([
      { type: 'tool', tool: tool({ id: 'c1', status: 'running' }) },
      { type: 'text', id: 't1', text: 'working' },
      { type: 'tool', tool: tool({ id: 'c2' }) },
    ]);
    expect(isAwaitingModel(blocks)).toBe(false);
  });
});

describe('activeStep', () => {
  const running = (name: string, id: string): MessagePart => ({
    type: 'tool',
    tool: { id, name, status: 'running' },
  });

  // Batched calls execute in announcement order, so the first is the one actually working.
  it('names the first in-flight call of a batch', () => {
    const parts = [running('get_document', 'c1'), running('list_components', 'c2')];
    expect(activeStep(msg({ parts }))?.id).toBe('c1');
  });

  it('is undefined when nothing is in flight', () => {
    expect(activeStep(msg({ parts: [{ type: 'tool', tool: tool() }] }))).toBeUndefined();
  });
});
