import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import type { Connection, ConnectionContext } from 'agents';
import { trimHistory, sanitizeHistory, appendTurn, trimForHistory, buildRestoredHistory, turnMayCommit, turnHasOutput } from './history.js';
import { buildContextNote } from './prompt.js';
import { injectPuckIds } from './tools.js';
import { ChatAgent } from './agent.js';

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
  /** One exchange: a brief, `calls` tool calls each answered, then a closing reply. */
  const exchange = (n: number, calls: number): Msg[] => [
    user(`brief ${n}`),
    ...Array.from({ length: calls }, (_, i) => [assistantWithTool(`t${n}-${i}`), toolResult(`t${n}-${i}`)]).flat(),
    assistant(`reply ${n}`),
  ];

  it('returns history unchanged when under the limit', () => {
    const h = [user('hello'), assistant('hi')];
    expect(trimHistory(h, 20, 3)).toEqual(h);
  });

  it('keeps the most recent exchanges and drops the oldest', () => {
    const h = [1, 2, 3, 4].flatMap(n => [user(`brief ${n}`), assistant(`reply ${n}`)]);

    const result = trimHistory(h, 2, 3);

    expect(result.map(m => m.content)).toEqual(['brief 3', 'reply 3', 'brief 4', 'reply 4']);
  });

  it('keeps every exchange of a tool-heavy conversation', () => {
    const h = [1, 2, 3].flatMap(n => exchange(n, 8));

    const briefs = trimHistory(h).filter(m => m.role === 'user').map(m => m.content);

    expect(briefs).toEqual(['brief 1', 'brief 2', 'brief 3']);
  });

  it('never empties history while any user message survives', () => {
    const h = exchange(1, 30);

    const result = trimHistory(h);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toEqual(user('brief 1'));
  });

  it('reduces older exchanges to what was said, keeping tool traffic only for recent ones', () => {
    const h = [1, 2, 3].flatMap(n => exchange(n, 2));

    const result = trimHistory(h, 20, 1);

    expect(result.slice(0, 4)).toEqual([
      user('brief 1'), assistant('reply 1'),
      user('brief 2'), assistant('reply 2'),
    ]);
    expect(result.filter(m => m.role === 'tool')).toHaveLength(2);
  });

  // A tool result whose call was dropped is exactly what the model API rejects.
  it('never starts with an orphaned tool result', () => {
    const h = [1, 2, 3].flatMap(n => exchange(n, 4));

    for (const max of [1, 2, 3]) {
      const result = trimHistory(h, max, 1);
      expect(result[0].role).toBe('user');
    }
  });

  it('keeps the newest exchange rather than everything when given a zero budget', () => {
    const h = [1, 2, 3].flatMap(n => [user(`brief ${n}`), assistant(`reply ${n}`)]);

    expect(trimHistory(h, 0, 3).map(m => m.content)).toEqual(['brief 3', 'reply 3']);
  });

  it('sanitizes even when history is under the limit', () => {
    const h = [
      toolResult('orphan'),  // bad leading entry, but well under the exchange cap
      assistant('reply'),
      user('clean message'),
    ];

    expect(trimHistory(h, 20, 3)).toEqual([user('clean message')]);
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

  // A cancelled turn is persisted mid-loop, so it can announce calls that never ran.
  // Leaving them in breaks the *next* turn, not the one that was interrupted.
  it('strips a tool call that never got a result', () => {
    const h = [user('build a page'), assistantWithTool('t1')];
    expect(sanitizeHistory(h)).toEqual([user('build a page')]);
  });

  it('keeps what the agent said when dropping its unanswered calls', () => {
    const spoke: Msg = {
      role: 'assistant',
      content: 'Adding the FAQ section now.',
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'some_tool', arguments: '{}' } }],
    };
    expect(sanitizeHistory([user('go'), spoke])).toEqual([
      user('go'),
      assistant('Adding the FAQ section now.'),
    ]);
  });

  it('keeps the answered calls of a partly-executed batch', () => {
    const batch: Msg = {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 't1', type: 'function', function: { name: 'some_tool', arguments: '{}' } },
        { id: 't2', type: 'function', function: { name: 'some_tool', arguments: '{}' } },
      ],
    };
    const result = sanitizeHistory([user('go'), batch, toolResult('t1')]);

    expect(result).toHaveLength(3);
    expect((result[1] as { tool_calls: { id: string }[] }).tool_calls.map(c => c.id)).toEqual(['t1']);
    expect(result[2]).toEqual(toolResult('t1'));
  });

  it('drops a tool result whose call is gone, wherever it sits', () => {
    const h = [user('first'), assistant('ok'), toolResult('ghost'), user('second')];
    expect(sanitizeHistory(h)).toEqual([user('first'), assistant('ok'), user('second')]);
  });
});

describe('buildRestoredHistory — ordered parts', () => {
  const call = (id: string, name: string): Msg => ({
    role: 'assistant',
    content: '',
    tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }],
  });

  it('records prose and calls in the order they happened', () => {
    const h: Msg[] = [
      user('build it'),
      { role: 'assistant', content: "I'll read the page." },
      call('t1', 'get_document'),
      toolResult('t1'),
      { role: 'assistant', content: 'That page is empty.' },
      call('t2', 'apply_document_edits'),
      toolResult('t2'),
      { role: 'assistant', content: 'Done.' },
    ];

    const [, assistantTurn] = buildRestoredHistory(h);

    expect(assistantTurn.parts?.map(p => (p.type === 'text' ? p.text : `tool:${p.tool.name}`))).toEqual([
      "I'll read the page.",
      'tool:get_document',
      'That page is empty.',
      'tool:apply_document_edits',
      'Done.',
    ]);
  });

  it('pairs each call with the result it returned', () => {
    const h: Msg[] = [
      user('go'),
      call('t1', 'apply_document_edits'),
      { role: 'tool', tool_call_id: 't1', content: '{"success":true,"operationsApplied":3}' } as Msg,
    ];

    const [, assistantTurn] = buildRestoredHistory(h);
    const part = assistantTurn.parts?.[0];

    expect(part?.type).toBe('tool');
    expect(part?.type === 'tool' && part.tool.result).toEqual({ success: true, operationsApplied: 3 });
  });

  it('omits parts from a user turn', () => {
    const [userTurn] = buildRestoredHistory([user('hi'), assistant('hello')]);

    expect(userTurn.parts).toBeUndefined();
    expect(userTurn.toolCalls).toBeUndefined();
  });
});

describe('turnHasOutput', () => {
  it('is false for a turn stopped before the model replied', () => {
    expect(turnHasOutput([user('hi')])).toBe(false);
  });

  it('is false for an assistant entry that said nothing and called nothing', () => {
    expect(turnHasOutput([user('hi'), assistant('')])).toBe(false);
  });

  it('is true once any prose has streamed', () => {
    expect(turnHasOutput([user('hi'), assistant('Hi the')])).toBe(true);
  });

  it('is true for a turn that ran a tool', () => {
    expect(turnHasOutput([user('go'), assistantWithTool('t1'), toolResult('t1')])).toBe(true);
  });
});

describe('turnMayCommit', () => {
  it('lets a turn commit when the conversation has never been cleared', () => {
    expect(turnMayCommit(undefined, 0)).toBe(true);
  });

  it('blocks a turn that a clear landed on top of', () => {
    expect(turnMayCommit(1, 0)).toBe(false);
  });

  it('lets a turn commit in a conversation cleared before it began', () => {
    expect(turnMayCommit(2, 2)).toBe(true);
  });

  it('blocks a turn that a second clear landed on top of', () => {
    expect(turnMayCommit(3, 2)).toBe(false);
  });
});

describe('appendTurn', () => {
  it('appends a turn to the conversation as stored', () => {
    const stored = [user('first'), assistant('reply')];
    expect(appendTurn(stored, [user('second'), assistant('second reply')], 20)).toEqual([
      user('first'),
      assistant('reply'),
      user('second'),
      assistant('second reply'),
    ]);
  });

  // The race this exists for: a clear commits while the model streams. Reading state at
  // commit time means the turn lands on the empty conversation instead of resurrecting
  // everything it started from.
  it('does not resurrect a conversation cleared while the turn ran', () => {
    expect(appendTurn([], [user('second'), assistant('second reply')], 20)).toEqual([
      user('second'),
      assistant('second reply'),
    ]);
  });

  // Same race between two tabs: whoever commits second must keep the other's turn.
  it('keeps a turn another writer committed first', () => {
    const committedByOtherTab = [user('theirs'), assistant('their reply')];
    expect(appendTurn(committedByOtherTab, [user('mine'), assistant('my reply')], 20)).toEqual([
      user('theirs'),
      assistant('their reply'),
      user('mine'),
      assistant('my reply'),
    ]);
  });

  it('trims to the exchange limit, keeping the newest', () => {
    const stored = [1, 2, 3].flatMap(n => [user(`old ${n}`), assistant(`reply ${n}`)]);

    const result = appendTurn(stored, [user('newest'), assistant('newest reply')], 2, 3);

    expect(result.map(m => m.content)).toEqual(['old 3', 'reply 3', 'newest', 'newest reply']);
  });

  it('drops an interrupted turn\'s unanswered calls as it commits', () => {
    const interrupted: Msg[] = [
      user('build a page'),
      { role: 'assistant', content: 'Reading the page.', tool_calls: [
        { id: 't1', type: 'function', function: { name: 'some_tool', arguments: '{}' } },
      ] },
    ];
    expect(appendTurn([], interrupted, 20)).toEqual([
      user('build a page'),
      assistant('Reading the page.'),
    ]);
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
      {
        role: 'assistant',
        content: 'hello there',
        parts: [{ type: 'text', text: 'hello there' }],
      },
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
    const result = injectPuckIds(input) as { type: string; props: Record<string, unknown> }[];
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

describe('ChatAgent state protocol', () => {
  // On the prototype: constructing the agent needs a live Durable Object.
  const connection = { id: 'c1' } as unknown as Connection;

  it('sends no protocol messages, which would carry state to an unauthorized connection', () => {
    expect(ChatAgent.prototype.shouldSendProtocolMessages(connection, {} as ConnectionContext)).toBe(false);
  });

  it('rejects a state update originating from a client', () => {
    expect(() => ChatAgent.prototype.validateStateChange({ conversationHistory: [] }, connection)).toThrow();
  });

  it("accepts the agent's own state update", () => {
    expect(() => ChatAgent.prototype.validateStateChange({ conversationHistory: [] }, 'server')).not.toThrow();
  });
});
