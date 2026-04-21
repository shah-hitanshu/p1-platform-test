import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { trimHistory, sanitizeHistory, trimForHistory } from './history.js';
import { injectPuckIds } from './tools.js';

const user = (content: string): Anthropic.MessageParam => ({ role: 'user', content });
const assistant = (content: string): Anthropic.MessageParam => ({ role: 'assistant', content });
const toolUse = (id: string): Anthropic.ContentBlock => ({ type: 'tool_use', id, name: 'some_tool', input: {} });
const toolResult = (id: string): Anthropic.ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: id, content: 'ok' });

const assistantWithTool = (id: string): Anthropic.MessageParam => ({
  role: 'assistant',
  content: [toolUse(id)],
});

const userWithToolResult = (id: string): Anthropic.MessageParam => ({
  role: 'user',
  content: [toolResult(id)],
});

describe('trimHistory', () => {
  it('returns history unchanged when under the limit', () => {
    const h = [user('hello'), assistant('hi')];
    expect(trimHistory(h, 20)).toEqual(h);
  });

  it('returns history unchanged when exactly at the limit', () => {
    const h = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? user(`msg ${i}`) : assistant(`reply ${i}`)));
    expect(trimHistory(h, 20)).toHaveLength(20);
  });

  it('trims to maxLength when history starts cleanly on a user message', () => {
    const h = Array.from({ length: 22 }, (_, i) => (i % 2 === 0 ? user(`msg ${i}`) : assistant(`reply ${i}`)));
    const result = trimHistory(h, 20);
    expect(result).toHaveLength(20);
    expect(result[0].role).toBe('user');
    expect(typeof result[0].content).toBe('string');
  });

  // Regression test: slice(-N) cutting into a tool turn would leave orphaned
  // tool_result blocks at the start of history, causing the Anthropic API to
  // reject the request with "unexpected tool_use_id found in tool_result blocks".
  it('skips leading tool_result-only user messages after trimming', () => {
    // Build 22-message history where messages 2-3 are a tool turn pair
    const h: Anthropic.MessageParam[] = [
      user('first'),             // 0
      assistantWithTool('t1'),   // 1
      userWithToolResult('t1'),  // 2  ← tool_result-only
      assistant('done with t1'), // 3
      user('second'),            // 4
      assistantWithTool('t2'),   // 5
      userWithToolResult('t2'),  // 6  ← tool_result-only
      assistant('done with t2'), // 7
      user('third'),             // 8
      assistant('reply'),        // 9
      // pad to 22 messages with plain turns
      ...Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? user(`pad ${i}`) : assistant(`pad reply ${i}`))),
    ];

    const result = trimHistory(h, 20);

    // Result must never start with a tool_result-only user message
    const first = result[0];
    expect(first.role).toBe('user');
    if (Array.isArray(first.content)) {
      expect(first.content.some(b => (b as { type: string }).type !== 'tool_result')).toBe(true);
    }
  });

  it('returns empty array when no clean user message exists in the trimmed window', () => {
    // Degenerate case: entire maxLength window is tool-result-only user turns
    const h: Anthropic.MessageParam[] = [
      user('real start'),         // 0 — gets cut off
      assistantWithTool('t1'),    // 1
      userWithToolResult('t1'),   // 2  ← tool_result-only
      assistantWithTool('t2'),    // 3
      userWithToolResult('t2'),   // 4  ← tool_result-only
    ];
    // maxLength=2 cuts to [userWithToolResult('t2'), assistant(...)]  — no clean user msg
    // The function must return [] rather than bad history
    const result = trimHistory(h, 2);
    expect(result).toEqual([]);
  });

  it('does not trim when the slice already starts on a clean user message', () => {
    const h: Anthropic.MessageParam[] = [
      user('clean start'),
      assistant('reply'),
      user('second'),
      assistant('reply2'),
    ];
    // Limit larger than history — no trimming needed
    const result = trimHistory(h, 10);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(user('clean start'));
  });

  it('sanitizes even when history is under the limit', () => {
    const h = [
      userWithToolResult('orphan'),  // bad leading entry, but length=3 < maxLength=20
      assistant('reply'),
      user('clean message'),
    ];
    const result = trimHistory(h, 20);
    // Should sanitize even though length <= maxLength — strips up to first clean user message
    expect(result).toEqual([user('clean message')]);
  });
});

describe('sanitizeHistory', () => {
  it('returns history unchanged when it starts with a clean user message', () => {
    const h = [user('hello'), assistant('hi'), user('world')];
    expect(sanitizeHistory(h)).toEqual(h);
  });

  it('strips a leading tool_result-only user message', () => {
    const h = [
      userWithToolResult('t1'),   // orphan — stripped up to first clean user message
      assistant('reply'),
      user('normal message'),
    ];
    const result = sanitizeHistory(h);
    // sanitizeHistory slices from the first clean user message (index 2)
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(user('normal message'));
  });

  it('strips multiple leading orphaned entries before the first clean user message', () => {
    const h = [
      assistantWithTool('t1'),    // leading assistant (no prior user)
      userWithToolResult('t1'),   // tool_result-only
      assistant('done'),
      user('real message'),
      assistant('response'),
    ];
    const result = sanitizeHistory(h);
    expect(result[0]).toEqual(user('real message'));
    expect(result).toHaveLength(2);
  });

  it('returns empty array when there is no clean user message at all', () => {
    const h = [assistantWithTool('t1'), userWithToolResult('t1')];
    expect(sanitizeHistory(h)).toEqual([]);
  });

  it('handles empty input', () => {
    expect(sanitizeHistory([])).toEqual([]);
  });
});

describe('trimForHistory', () => {
  it('drops snapshot from get_document results, keeping only identity fields', () => {
    const result = {
      documentId: 'doc-1',
      versionNumber: 4,
      snapshot: { content: [{ type: 'HeroBlock', props: {} }], root: {}, zones: [] },
      patch: 'huge-json-string',
      source: 'realtime',
      createdById: 'user-1',
    };
    const trimmed = trimForHistory('get_document', result) as Record<string, unknown>;
    expect(trimmed.documentId).toBe('doc-1');
    expect(trimmed.versionNumber).toBe(4);
    expect(trimmed.snapshot).toBeUndefined();
    expect(trimmed.patch).toBeUndefined();
    expect(trimmed.source).toBeUndefined();
    expect(trimmed.createdById).toBeUndefined();
  });

  it('strips snapshot from apply_document_edits results', () => {
    const result = {
      success: true,
      operationsApplied: 3,
      snapshot: { content: [{ type: 'HeroBlock' }] },
    };
    const trimmed = trimForHistory('apply_document_edits', result) as Record<string, unknown>;
    expect(trimmed.snapshot).toBeUndefined();
    expect(trimmed.success).toBe(true);
    expect(trimmed.operationsApplied).toBe(3);
  });

  it('strips field schemas from list_components results', () => {
    const result = {
      components: [
        { name: 'HeroBlock', description: 'A hero', fields: { title: {} } },
        { name: 'FooterBlock', description: 'A footer', fields: { text: {} } },
      ],
    };
    const trimmed = trimForHistory('list_components', result) as Record<string, unknown>;
    const components = trimmed.components as Record<string, unknown>[];
    expect(components[0].fields).toBeUndefined();
    expect(components[0].name).toBe('HeroBlock');
    expect(components[0].description).toBe('A hero');
  });

  it('passes through small tool results unchanged', () => {
    const result = { canEdit: true, conflictingRegions: [] };
    expect(trimForHistory('check_edit_permission', result)).toEqual(result);
  });

  it('passes through non-object results unchanged', () => {
    expect(trimForHistory('complete_edit_session', 'ok')).toBe('ok');
  });

  it('preserves error field in apply_document_edits error results', () => {
    const result = { error: 'Edit session expired' };
    const trimmed = trimForHistory('apply_document_edits', result) as Record<string, unknown>;
    expect(trimmed.error).toBe('Edit session expired');
    expect(trimmed.snapshot).toBeUndefined();
  });
});

describe('injectPuckIds', () => {
  it('injects an id into a single component missing one', () => {
    const input = { type: 'HeroBlock', props: { title: 'hello' } };
    const result = injectPuckIds(input) as { type: string; props: Record<string, unknown> };
    expect(result.props.id).toBeTruthy();
    expect(typeof result.props.id).toBe('string');
    expect(result.props.title).toBe('hello');
  });

  it('preserves an existing id', () => {
    const input = { type: 'HeroBlock', props: { id: 'existing-id', title: 'hello' } };
    const result = injectPuckIds(input) as { type: string; props: Record<string, unknown> };
    expect(result.props.id).toBe('existing-id');
  });

  it('injects ids into an array of components, skipping ones that have them', () => {
    const input = [
      { type: 'HeroBlock', props: { id: 'keep-me' } },
      { type: 'StatsBlock', props: { columns: 4 } },
      { type: 'TextIntroBlock', props: { body: 'hi' } },
    ];
    const result = injectPuckIds(input) as Array<{ type: string; props: Record<string, unknown> }>;
    expect(result[0].props.id).toBe('keep-me');
    expect(result[1].props.id).toBeTruthy();
    expect(result[2].props.id).toBeTruthy();
    expect(result[1].props.id).not.toBe(result[2].props.id);
  });

  it('passes through non-component values unchanged', () => {
    expect(injectPuckIds('a string')).toBe('a string');
    expect(injectPuckIds(42)).toBe(42);
    expect(injectPuckIds(null)).toBeNull();
    expect(injectPuckIds({ notAComponent: true })).toEqual({ notAComponent: true });
  });
});
