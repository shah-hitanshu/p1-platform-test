import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { afterToolError } from '../conversation/turn-step.js';
import { executeTool } from '../tools/execute-tool.js';
import type { ChatContext } from '../types.js';
import { CcrApiError, McpApiClient } from './api-client.js';

const DOC = { siteId: 'site-1', branchId: 'branch-1', documentPath: '/home' };

/** A CCR stand-in that bars one turn the way the real one does. */
function barringCcr(turnIdToBar: string) {
  let barred = false;
  const writes: string[] = [];

  return {
    writes,
    stop: () => { barred = true; },
    fetcher: {
      fetch: (url: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;

        if (barred && headers['X-Agent-Turn-Id'] === turnIdToBar) {
          return Promise.resolve(new Response(
            JSON.stringify({ error: 'Turn stopped by a user', code: 'agent_turn_stopped' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ));
        }

        // Recorded past the bar, so the list holds writes CCR accepted. Counting
        // attempts instead would pass whether or not the refusal worked.
        if (String(url).endsWith('/edits')) writes.push(String(url));
        return Promise.resolve(new Response(
          JSON.stringify({ success: true, editSessionId: 'edit-1', allowed: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
      },
    },
  };
}

function clientFor(ccr: ReturnType<typeof barringCcr>, turnId: string): McpApiClient {
  return new McpApiClient({
    baseUrl: 'https://ccr.test',
    agentId: 'agent-1',
    agentApiKey: 'key',
    turnId,
    fetcher: ccr.fetcher,
  });
}

describe('a turn a user stopped', () => {
  it('lands no write, and ends the turn instead of retrying', async () => {
    const ccr = barringCcr('turn-abc');
    const client = clientFor(ccr, 'turn-abc');

    await client.startAgentEdit({
      ...DOC, trigger: 'human_requested', intent: 'Rewrite the intro',
      targetRegions: ['content.0'],
    });
    ccr.stop();

    const err = await client.applyEdits({
      ...DOC, editSessionId: 'edit-1', operations: [],
    }).catch((e: unknown) => e);

    expect(afterToolError(err)).toBe('end_turn');
    expect(ccr.writes).toHaveLength(0);
  });

  it('cannot open another session to get around it', async () => {
    const ccr = barringCcr('turn-abc');
    const client = clientFor(ccr, 'turn-abc');
    ccr.stop();

    const err = await client.startAgentEdit({
      ...DOC, trigger: 'human_requested', intent: 'Rewrite again',
      targetRegions: ['content.0'],
    }).catch((e: unknown) => e);

    expect(afterToolError(err)).toBe('end_turn');
  });

  it('leaves another turn alone', async () => {
    const ccr = barringCcr('turn-abc');
    const client = clientFor(ccr, 'turn-other');
    ccr.stop();

    await client.applyEdits({ ...DOC, editSessionId: 'edit-1', operations: [] });

    expect(ccr.writes).toHaveLength(1);
  });
});

/**
 * A stop is only enforced where both sides derive the same id from the same raw value,
 * and CCR's copy of that rule lives in another worker this one cannot import. Read it
 * instead: nothing else would notice the day the two stop agreeing.
 */
describe('the turn id this worker sends and the one CCR records', () => {
  const ccrLimits = fileURLToPath(
    new URL('../../../ccr/src/constants/security-limits.ts', import.meta.url),
  );

  function ccrTurnIdLimit(): number {
    const match = /export const MAX_TURN_ID_LENGTH = (\d+);/.exec(readFileSync(ccrLimits, 'utf8'));
    if (match === null) {
      throw new Error(`MAX_TURN_ID_LENGTH not found in ${ccrLimits} — did it move or get renamed?`);
    }
    return Number(match[1]);
  }

  /** The header as it actually leaves the client, for whatever turn id it was built with. */
  async function headerFor(turnId: string): Promise<string | undefined> {
    let sent: Record<string, string> | undefined;
    const client = new McpApiClient({
      baseUrl: 'https://ccr.test',
      agentId: 'agent-1',
      agentApiKey: 'key',
      turnId,
      fetcher: {
        fetch: (_url: RequestInfo | URL, init?: RequestInit) => {
          sent = (init?.headers ?? {}) as Record<string, string>;
          return Promise.resolve(new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ));
        },
      },
    });

    await client.applyEdits({ ...DOC, editSessionId: 'edit-1', operations: [] });
    return sent?.['X-Agent-Turn-Id'];
  }

  it('truncates at the same length', async () => {
    const limit = ccrTurnIdLimit();

    expect(await headerFor('t'.repeat(limit * 2))).toHaveLength(limit);
  });

  it('replaces CR/LF with a space rather than dropping them', async () => {
    expect(await headerFor('turn\r\nabc')).toBe('turn  abc');
  });

  // CCR replaces, then trims, then slices. Leading space is what tells the orders apart:
  // trimming first leaves a full-length id, slicing first eats three characters off the
  // end of it. Same raw value, different id, and the bar then matches nothing.
  it('trims before it truncates, not after', async () => {
    const limit = ccrTurnIdLimit();

    expect(await headerFor(`   ${'a'.repeat(limit)} tail`)).toBe('a'.repeat(limit));
  });

  it('sends no header at all rather than an empty one', async () => {
    expect(await headerFor('   ')).toBeUndefined();
  });
});

/**
 * A stop only ends the turn while it is still recognisable when it gets back: the loop
 * asks `afterToolError`, which asks `instanceof CcrApiError`. A tool case that caught its
 * error and rewrapped it would leave a stop reading as one failed call, and the model
 * would try another — which is the retry the stop exists to end.
 */
describe('a stop on its way back out through executeTool', () => {
  const context: ChatContext = {
    siteId: DOC.siteId,
    branchId: DOC.branchId,
    documentPath: 'home',
    token: 'test-token',
    writeSet: ['home'],
  };

  const refusal = (): CcrApiError =>
    new CcrApiError('Turn stopped by a user', 409, 'agent_turn_stopped');

  it.each([
    ['start_edit_session', 'startAgentEdit', { intent: 'Rewrite the intro', target_regions: ['content.0'] }],
    // A removal, so the op needs no snapshot or registry prefetched to validate it.
    ['apply_document_edits', 'applyEdits', { edit_session_id: 'edit-1', operations: [{ type: 'remove', path: 'content.0' }] }],
  ] as const)('reaches the loop intact from %s', async (tool, method, input) => {
    const ccrApi = { [method]: vi.fn().mockRejectedValue(refusal()) } as unknown as McpApiClient;

    const err = await executeTool(
      tool,
      { site_id: DOC.siteId, branch_id: DOC.branchId, document_path: 'home', ...input },
      ccrApi,
      'user-1',
      context,
    ).catch((e: unknown) => e);

    expect(afterToolError(err)).toBe('end_turn');
  });
});
