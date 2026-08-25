import { describe, it, expect } from 'vitest';
import type { CompletionResult, FnToolCall } from '../providers/transport.js';
import {
  MAX_TURN_STEPS,
  STEP_LIMIT_MESSAGE,
  TRUNCATED_NUDGE,
  afterCompletion,
  atStepLimit,
  trackedEditSession,
} from './turn-step.js';

const call = (name: string): FnToolCall => ({
  id: `call_${name}`,
  type: 'function',
  function: { name, arguments: '{}' },
});

const completion = (over: Partial<CompletionResult> = {}): CompletionResult => ({
  content: '',
  toolCalls: [],
  ...over,
});

describe('atStepLimit', () => {
  it('allows exactly maxSteps calls, counting from zero', () => {
    expect(atStepLimit(0, 3)).toBe(false);
    expect(atStepLimit(2, 3)).toBe(false);
    expect(atStepLimit(3, 3)).toBe(true);
  });

  it('defaults to the shipped budget', () => {
    expect(atStepLimit(MAX_TURN_STEPS - 1)).toBe(false);
    expect(atStepLimit(MAX_TURN_STEPS)).toBe(true);
  });
});

describe('afterCompletion', () => {
  it('runs the tools the model asked for', () => {
    const toolCalls = [call('get_document'), call('apply_document_edits')];
    expect(afterCompletion(completion({ toolCalls, stopReason: 'tool_calls' })))
      .toEqual({ kind: 'run_tools', toolCalls });
  });

  it('completes the turn when no tools were requested', () => {
    expect(afterCompletion(completion({ content: 'done', stopReason: 'stop' })))
      .toEqual({ kind: 'complete' });
  });

  it('drops tool calls from a reply cut at the output limit', () => {
    // The danger case: arguments can be truncated mid-JSON, and a half-written
    // apply_document_edits is the one that would land on the page.
    const result = afterCompletion(completion({
      content: 'I will update the he',
      toolCalls: [call('apply_document_edits')],
      stopReason: 'length',
    }));
    expect(result).toEqual({ kind: 'continue_truncated', toolCallsDropped: 1 });
    expect(result).not.toHaveProperty('toolCalls');
  });

  it('continues rather than completing when a cut reply carried no tool calls', () => {
    expect(afterCompletion(completion({ content: 'half a sen', stopReason: 'length' })))
      .toEqual({ kind: 'continue_truncated', toolCallsDropped: 0 });
  });

  it('treats an absent stop reason as a normal completion', () => {
    // Providers that report none must not be read as truncated.
    const toolCalls = [call('get_document')];
    expect(afterCompletion(completion({ toolCalls }))).toEqual({ kind: 'run_tools', toolCalls });
    expect(afterCompletion(completion({}))).toEqual({ kind: 'complete' });
  });
});

describe('the strings the turn sends', () => {
  it('tells the user their work survived the step limit', () => {
    expect(STEP_LIMIT_MESSAGE).toContain('saved');
  });

  it('tells the model to work smaller rather than to stop', () => {
    expect(TRUNCATED_NUDGE).toContain('smaller steps');
  });
});

describe('trackedEditSession', () => {
  const input = { site_id: 's1', branch_id: 'b1', document_path: 'about' };

  it('tracks the session the backend named', () => {
    expect(trackedEditSession(input, { editSessionId: 'sess-1' })).toEqual({
      siteId: 's1', branchId: 'b1', documentPath: 'about', editSessionId: 'sess-1',
    });
  });

  it.each([
    ['no id at all', {}],
    ['an id of the wrong type', { editSessionId: 42 }],
    ['an empty id', { editSessionId: '' }],
    ['a result that is not an object', 'sess-1'],
    ['a null result', null],
  ])('tracks nothing given %s', (_label, result) => {
    expect(trackedEditSession(input, result)).toBeNull();
  });

  it.each(['site_id', 'branch_id', 'document_path'])('tracks nothing when %s is missing', key => {
    const partial = { ...input, [key]: undefined };
    expect(trackedEditSession(partial, { editSessionId: 'sess-1' })).toBeNull();
  });
});
