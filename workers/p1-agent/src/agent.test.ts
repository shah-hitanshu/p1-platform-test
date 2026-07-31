import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { trimHistory, sanitizeHistory, trimForHistory, buildRestoredHistory } from './history.js';
import { buildContextNote } from './prompt.js';
import { injectPuckIds } from './tools.js';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const user = (content: string): Msg => ({ role: 'user', content });
const assistant = (content: string): Msg => ({ role: 'assistant', content });
// Assistant turn that requests a tool call (OpenAI shape).
const assistantWithTool = (id: string): Msg => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ id, type: 'function', function: { name: 'some_tool', arguments: '{}' } }],
});
// A tool result message. Orphaned when it has no preceding assistant tool_call.
const toolResult = (id: string): Msg => ({ role: 'tool', tool_call_id: id, content: 'ok' });

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

  // Regression test: slice(-N) cutting into a tool turn would leave an orphaned
  // tool message (a tool result with no preceding assistant tool_call) at the start
  // of history, which the model API rejects.
  it('skips leading orphaned tool messages after trimming', () => {
    const h: Msg[] = [
      user('first'),             // 0
      assistantWithTool('t1'),   // 1
      toolResult('t1'),          // 2  ← orphaned once 0-1 are cut
      assistant('done with t1'), // 3
      user('second'),            // 4
      assistantWithTool('t2'),   // 5
      toolResult('t2'),          // 6
      assistant('done with t2'), // 7
      user('third'),             // 8
      assistant('reply'),        // 9
      // pad to 22 messages with plain turns
      ...Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? user(`pad ${i}`) : assistant(`pad reply ${i}`))),
    ];

    const result = trimHistory(h, 20);

    // Result must never start with an orphaned tool message
    expect(result[0].role).toBe('user');
  });

  it('returns empty array when no clean user message exists in the trimmed window', () => {
    // Degenerate case: the trimmed window holds only assistant/tool turns
    const h: Msg[] = [
      user('real start'),         // 0 — gets cut off
      assistantWithTool('t1'),    // 1
      toolResult('t1'),           // 2
      assistantWithTool('t2'),    // 3
      toolResult('t2'),           // 4
    ];
    // maxLength=2 cuts to [assistantWithTool('t2'), toolResult('t2')] — no clean user msg
    const result = trimHistory(h, 2);
    expect(result).toEqual([]);
  });

  it('does not trim when the slice already starts on a clean user message', () => {
    const h: Msg[] = [
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
      toolResult('orphan'),  // bad leading entry, but length=3 < maxLength=20
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

  it('strips a leading orphaned tool message', () => {
    const h = [
      toolResult('t1'),   // orphan — stripped up to first clean user message
      assistant('reply'),
      user('normal message'),
    ];
    const result = sanitizeHistory(h);
    // sanitizeHistory slices from the first user message (index 2)
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(user('normal message'));
  });

  it('strips multiple leading orphaned entries before the first user message', () => {
    const h = [
      assistantWithTool('t1'),    // leading assistant (no prior user)
      toolResult('t1'),           // orphaned tool result
      assistant('done'),
      user('real message'),
      assistant('response'),
    ];
    const result = sanitizeHistory(h);
    expect(result[0]).toEqual(user('real message'));
    expect(result).toHaveLength(2);
  });

  it('returns empty array when there is no user message at all', () => {
    const h = [assistantWithTool('t1'), toolResult('t1')];
    expect(sanitizeHistory(h)).toEqual([]);
  });

  it('handles empty input', () => {
    expect(sanitizeHistory([])).toEqual([]);
  });

  // Legacy Durable Object state from the Anthropic era stored array-shaped content.
  // Those entries are invalid under the OpenAI shape and must be dropped so old
  // sessions self-heal rather than crash.
  it('drops legacy Anthropic-shaped (array-content) messages', () => {
    const legacyUser = { role: 'user', content: [{ type: 'text', text: 'hi' }] } as unknown as Msg;
    const h = [legacyUser, assistant('reply'), user('clean')];
    expect(sanitizeHistory(h)).toEqual([user('clean')]);
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

describe('buildRestoredHistory', () => {
  const assistantToolTurn = (text: string, id: string, name: string, args: string): Msg => ({
    role: 'assistant',
    content: text,
    tool_calls: [{ id, type: 'function', function: { name, arguments: args } }],
  });

  it('maps a plain user/assistant exchange', () => {
    const restored = buildRestoredHistory([
      user('hi'),
      assistant('hello there'),
    ]);
    expect(restored).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
    ]);
  });

  it('collapses a multi-iteration agentic turn into one assistant entry with tool calls', () => {
    const restored = buildRestoredHistory([
      user('add a hero'),
      assistantToolTurn('On it.', 'call-1', 'apply_document_edits', '{"site_id":"s1"}'),
      { role: 'tool', tool_call_id: 'call-1', content: JSON.stringify({ success: true, operationsApplied: 2 }) },
      assistant('Done — added the hero.'),
    ]);

    expect(restored).toHaveLength(2);
    expect(restored[0]).toEqual({ role: 'user', content: 'add a hero' });

    const asst = restored[1];
    expect(asst.role).toBe('assistant');
    // Assistant text from both iterations is merged.
    expect(asst.content).toBe('On it.\n\nDone — added the hero.');
    expect(asst.toolCalls).toHaveLength(1);
    expect(asst.toolCalls![0]).toEqual({
      name: 'apply_document_edits',
      input: { site_id: 's1' },
      result: { success: true, operationsApplied: 2 },
    });
  });

  it('drops empty assistant entries and omits empty toolCalls arrays', () => {
    const restored = buildRestoredHistory([
      user('hi'),
      { role: 'assistant', content: '' }, // empty, no tool calls → dropped
    ]);
    expect(restored).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('keeps the raw string when a tool result is not JSON', () => {
    const restored = buildRestoredHistory([
      user('go'),
      assistantToolTurn('', 'call-9', 'complete_edit_session', '{}'),
      { role: 'tool', tool_call_id: 'call-9', content: 'ok' },
    ]);
    expect(restored[1].toolCalls![0].result).toBe('ok');
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

describe('buildContextNote', () => {
  const base = { siteId: 's1', branchId: 'b1', documentPath: '/pricing', token: 't' };

  // The product decision on PCC-3440: a thin brief gets a draft, not a question. Without
  // this the model opens with "which page would you like me to use?".
  it('tells the agent to draft immediately for a freshly created page', () => {
    const note = buildContextNote({ ...base, documentId: 'd1', newPage: true });

    expect(note).toContain('was just created for this request and is empty');
    expect(note).toContain('do not ask which page to use');
    expect(note).toContain('rather than asking clarifying questions');
  });

  it('does not add the drafting instruction to an ordinary turn', () => {
    const note = buildContextNote({ ...base, documentId: 'd1' });

    expect(note).not.toContain('asking clarifying questions');
    // The existing edit-workflow hint still applies to a document that already has content.
    expect(note).toContain('This document already exists');
  });

  it('replaces the edit-workflow hint rather than stacking both', () => {
    const note = buildContextNote({ ...base, documentId: 'd1', newPage: true });

    // Both at once reads as a contradiction: work around what is here, and also it is empty.
    expect(note).not.toContain('This document already exists');
  });

  // The Create Page dialog sets root.props.title but has nothing to derive a description
  // from, so an AI-drafted page would otherwise ship with an empty meta description.
  it('asks for an SEO description at the path the edit tool expects', () => {
    const note = buildContextNote({ ...base, documentId: 'd1', newPage: true });

    expect(note).toContain('root.props.description');
    expect(note).toContain('Leave "root.props.title" alone.');
  });

  // Written before the content it would describe a page that does not exist yet, so a
  // build that fails or is stopped leaves a confidently wrong description behind. Kept in
  // the same session because anything after complete_edit_session needs a second one.
  it('orders the description after the content, inside the same edit session', () => {
    const note = buildContextNote({ ...base, documentId: 'd1', newPage: true });

    expect(note).toContain('Build the content first');
    expect(note).toContain('before completing the same edit session');
    expect(note).toContain('from what you actually built');
  });

  it('allows a brief mention but not an explanation of SEO', () => {
    const note = buildContextNote({ ...base, documentId: 'd1', newPage: true });

    expect(note).toContain('one short clause is fine');
    expect(note).toContain('Do not explain what a meta description');
  });

  it('does not ask an ordinary turn to touch the description', () => {
    const note = buildContextNote({ ...base, documentId: 'd1' });

    expect(note).not.toContain('root.props.description');
  });

  it('labels the page as new rather than existing, despite it having an id', () => {
    const note = buildContextNote({ ...base, documentId: 'd1', newPage: true });

    expect(note).toContain('[Current editor context — new empty page]');
    expect(note).not.toContain('existing document');
  });

  it('still carries the ids the agent needs to act', () => {
    const note = buildContextNote({ ...base, newPage: true });

    expect(note).toContain('Site ID: s1');
    expect(note).toContain('Branch ID: b1');
    expect(note).toContain('Document: /pricing');
  });
});
