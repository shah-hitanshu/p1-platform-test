/**
 * Reporting a mention an agent never answered: the one log line it exists to produce,
 * the permission it settles for, the ids it takes, and that a refusal is never silent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/types';
import { makeBranch } from '../../helpers/branch';
import { makePrincipal } from '../../helpers/principal';
import { AGENT_ID, COMMENT_ID, SITE_ID, THREAD_ID, USER_ID } from '../../helpers/threads';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

vi.mock('../../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
}));

vi.mock('../../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
    constructor(
      message: string,
      public requiredPermission: string,
      public roleName: string,
    ) {
      super(message);
    }
  },
}));

const viewer: AuthenticatedPrincipal = makePrincipal({
  id: USER_ID,
  type: 'user',
  pantheonSiteRoles: { [SITE_ID]: 'viewer' },
});

const REPORT = { commentId: COMMENT_ID, agentId: AGENT_ID, elapsedMs: 4_200 };

function request(threadId: string, body: unknown, method = 'POST'): Request {
  return new Request(`https://api.example.com/api/sites/${SITE_ID}/threads/${threadId}/unanswered-mentions`, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
  });
}

async function post(body: unknown, threadId = THREAD_ID, method = 'POST') {
  const { handleThreadRoutes } = await import('../../../src/routes/threads');
  return await handleThreadRoutes(request(threadId, body, method), {
    siteId: SITE_ID,
    threadId,
    subResource: 'unanswered-mentions',
    principal: viewer,
  });
}

async function mocks() {
  return {
    branches: await import('../../../src/services/branch-service'),
    authorization: await import('../../../src/auth/authorization'),
  };
}

describe('POST threads/{threadId}/unanswered-mentions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { branches, authorization } = await mocks();
    vi.mocked(authorization.assertPermission).mockResolvedValue(undefined);
    vi.mocked(branches.getMainBranch).mockResolvedValue(makeBranch({ id: 'branch-main', siteId: SITE_ID }));
  });

  it('answers 204 with no body', async () => {
    const response = await post(REPORT);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('warns once, carrying the thread, the ask, the agent and the wait', async () => {
    await post(REPORT);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, fields] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('agent mention unanswered');
    expect(fields).toMatchObject({
      site_id: SITE_ID,
      thread_id: THREAD_ID,
      comment_id: COMMENT_ID,
      agent_id: AGENT_ID,
      age_ms: 4_200,
      reason: 'no_agent_response',
    });
    expect(fields.duration_ms).toEqual(expect.any(Number));
  });

  it('adds nothing at info, so counting the warn cannot double', async () => {
    await post(REPORT);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('asks only for canView', async () => {
    const { authorization } = await mocks();
    await post(REPORT);

    expect(authorization.assertPermission).toHaveBeenCalledWith(
      viewer,
      SITE_ID,
      'branch-main',
      'canView',
      undefined,
    );
  });

  it.each([
    ['a missing wait', { commentId: COMMENT_ID, agentId: AGENT_ID }],
    ['a negative wait', { ...REPORT, elapsedMs: -1 }],
    ['a wait no reader sat through', { ...REPORT, elapsedMs: 900_000 }],
    ['a fractional wait', { ...REPORT, elapsedMs: 1.5 }],
    ['a stand-in id in place of the ask', { ...REPORT, commentId: `pending:${COMMENT_ID}:${AGENT_ID}` }],
    ['an agent id that is not an id', { ...REPORT, agentId: 'Zappy' }],
    ['no body at all', undefined],
  ])('rejects %s with 400, and says so rather than going quiet', async (_name, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, fields] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('agent mention report rejected');
    expect(fields).toMatchObject({ site_id: SITE_ID, thread_id: THREAD_ID, reason: 'invalid_report' });
  });

  it.each([
    ['an agent id carrying no version', 'a0000000-0000-0000-0000-000000000001'],
    ['a user id of all one digit', '22222222-2222-2222-2222-222222222222'],
  ])('accepts %s, which the thread id on the same request would also be', async (_name, agentId) => {
    const response = await post({ ...REPORT, agentId });

    expect(response.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledWith('agent mention unanswered', expect.objectContaining({ agent_id: agentId }));
  });

  it('answers 404 for a thread id that cannot name a thread', async () => {
    const response = await post(REPORT, 'not-a-thread');

    expect(response.status).toBe(404);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('allows nothing but POST', async () => {
    const response = await post(REPORT, THREAD_ID, 'GET');

    expect(response.status).toBe(405);
  });
});
