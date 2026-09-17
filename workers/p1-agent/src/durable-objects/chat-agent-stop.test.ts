/**
 * A stop pressed while the model is still talking, driven through the real turn loop.
 *
 * The step a stop interrupts stores no message of its own, so what it streamed survives only
 * if the loop keeps it. On a first step that is the difference between a stored turn and none
 * at all: with no assistant entry there is nothing to mark and nothing counting as output.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Connection } from 'agents';
import { buildRestoredHistory, sanitizeHistory, type StoredMessage } from '../conversation/history.js';
import type { CompletionResult, StreamHandlers } from '../providers/transport.js';
import type { OutgoingMessage } from '../types.js';

const { createTransport } = vi.hoisted(() => ({ createTransport: vi.fn() }));

vi.mock('../auth.js', () => ({
  validateCCRToken: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@example.com', name: 'U' }),
}));

vi.mock('../ccr/api-client.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../ccr/api-client.js')>();
  return {
    ...actual,
    McpApiClient: class {
      lookupDocumentByPath = vi.fn().mockResolvedValue({ id: 'doc-1' });
      getTemplate = vi.fn().mockResolvedValue(null);
    },
  };
});

vi.mock('../providers/transport.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../providers/transport.js')>();
  return { ...actual, createTransport };
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

/** One model call: the text it streams, then the answer it returns. */
type Step = { text: string; answer: CompletionResult };

const answer = (content: string, stopReason?: 'length'): CompletionResult => ({
  content,
  toolCalls: [],
  ...(stopReason === undefined ? {} : { stopReason }),
});

/**
 * Run one turn against the given model calls, stopping it during the last one. Built on the
 * prototype because constructing an agent needs a live Durable Object; everything the turn
 * reaches is stubbed below.
 */
async function turnStoppedMidStream(steps: Step[]): Promise<{
  frames: OutgoingMessage[];
  history: StoredMessage[];
}> {
  const { ChatAgent } = await import('./chat-agent.js');

  const frames: OutgoingMessage[] = [];
  const connection = {
    id: 'conn-1',
    send: (raw: string) => { frames.push(JSON.parse(raw) as OutgoingMessage); },
  } as unknown as Connection;

  let stored: { conversationHistory: StoredMessage[] } = { conversationHistory: [] };
  const agent = Object.create(ChatAgent.prototype) as {
    onMessage: (c: Connection, m: string) => Promise<void>;
    setState: (s: unknown) => Promise<void>;
    env: unknown;
    templateIdByPath: Map<string, string>;
  };
  Object.defineProperty(agent, 'state', { get: () => stored });
  agent.setState = async (next: unknown) => { stored = next as typeof stored; };
  agent.env = {
    CCR_BACKEND_URL: 'http://ccr.test',
    AGENT_ID: 'agent-1',
    AGENT_API_KEY: 'key',
    AI_GATEWAY_ACCOUNT_ID: 'acct',
    AI_GATEWAY_NAME: 'gw',
    AI_GATEWAY_API_TOKEN: 'token',
    AGENT_MODEL: 'anthropic/claude-test',
  };
  agent.templateIdByPath = new Map();

  // The last call streams its text and then waits, so the stop lands while the stream is
  // open rather than racing the answer back.
  const streaming = deferred();
  const released = deferred();
  let call = 0;
  createTransport.mockReturnValue({
    stream: async (_req: unknown, handlers: StreamHandlers, signal: AbortSignal) => {
      const step = steps[call++];
      handlers.onText(step.text);
      if (call < steps.length) return step.answer;
      streaming.resolve();
      await released.promise;
      if (signal.aborted) {
        const err = new Error('Request was aborted.');
        err.name = 'AbortError';
        throw err;
      }
      return step.answer;
    },
  });

  const turn = agent.onMessage(connection, JSON.stringify({
    type: 'chat',
    turnId: 'turn-1',
    message: 'Rewrite the intro',
    context: {
      siteId: 'site-1',
      branchId: 'branch-1',
      documentPath: 'home',
      token: 'tok',
      writeSet: ['home'],
    },
  }));

  await streaming.promise;
  await agent.onMessage(connection, JSON.stringify({ type: 'cancel' }));
  released.resolve();
  await turn;

  return { frames, history: stored.conversationHistory };
}

describe('a stop that lands while the model is streaming', () => {
  it('keeps the text the user watched arrive, marked stopped', async () => {
    const { frames, history } = await turnStoppedMidStream([
      { text: 'Here is the rewritten ', answer: answer('never reached') },
    ]);

    expect(frames.at(-1)).toMatchObject({ type: 'cancelled' });
    expect(history.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(history[1]).toMatchObject({ content: 'Here is the rewritten ', stopped: true });

    // What a reopened tab is served, built the same way the get_history path builds it.
    expect(buildRestoredHistory(sanitizeHistory(history))).toMatchObject([
      { role: 'user', content: 'Rewrite the intro' },
      { role: 'assistant', content: 'Here is the rewritten ', stopped: true },
    ]);
  });

  it('marks the step that was running, and does not repeat the one that finished', async () => {
    const { history } = await turnStoppedMidStream([
      { text: 'First part', answer: answer('First part', 'length') },
      { text: 'and the ', answer: answer('never reached') },
    ]);

    expect(history.map(m => m.content)).toEqual(['Rewrite the intro', 'First part', 'and the ']);
    expect(history.map(m => m.stopped)).toEqual([undefined, undefined, true]);
  });
});
