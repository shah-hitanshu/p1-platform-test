/**
 * Who may stop an agent.
 *
 * The stopped-turn record is capped and evicts its oldest, and every stop puts an entry
 * in it — under the turn id the caller named, or under the one the stopped session
 * reported, which that agent supplied as a header when it reserved the session. So an
 * agent able to stop anything could reserve and stop its way through fifty turn ids
 * until the bar on its own turn fell off the front. Stopping is a person's action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal, Branch } from '../../src/types';

vi.mock('../../src/services/agent-service', () => ({ getAgentById: vi.fn() }));
vi.mock('../../src/services/document-service', () => ({ getDocumentByPath: vi.fn() }));
vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
}));
vi.mock('../../src/auth/authorization', () => ({ hasPermission: vi.fn() }));

import * as documentService from '../../src/services/document-service';
import * as branchService from '../../src/services/branch-service';
import { hasPermission } from '../../src/auth/authorization';
import {
  makeDurableObjectNamespace,
  type MockDurableObjectNamespace,
  type MockDurableObjectStub,
} from '../helpers/durable-object';

function branchForRef(siteId: string, ref: string): Branch {
  return {
    id: ref,
    siteId,
    name: ref,
    status: 'active',
    isMain: false,
    createdById: 'test-user',
    createdByType: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };
}

function principal(type: AuthenticatedPrincipal['type']): RealtimeRouteContext {
  return {
    principal: {
      id: `${type}-1`,
      type,
      pantheonSiteRoles: { 'site-1': 'admin' },
      tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
      authProvider: type === 'user' ? 'mock' : 'agent_key',
    },
  };
}

const STOP_URL =
  'https://example.com/api/sites/site-1/branches/branch-1/documents/page/agent-stop';

function stopRequest(body: Record<string, unknown>): Request {
  return new Request(STOP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface MockEnv {
  ENVIRONMENT: string;
  DOCUMENT_STATE: MockDurableObjectNamespace;
  POSTGRES_CONNECTION_STRING: string;
}

describe('agent-stop: who may stop an agent', () => {
  let mockEnv: MockEnv;
  let mockStub: MockDurableObjectStub;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(branchService.getBranchByName).mockImplementation(
      (siteId: string, name: string) => Promise.resolve(branchForRef(siteId, name)),
    );
    vi.mocked(documentService.getDocumentByPath).mockResolvedValue({
      id: 'mock-document-uuid',
      siteId: 'site-1',
      path: 'page',
      createdAt: new Date().toISOString(),
    });

    mockStub = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, rolledBack: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    };

    mockEnv = {
      ENVIRONMENT: 'test',
      DOCUMENT_STATE: makeDurableObjectNamespace(mockStub, {
        toString: (): string => 'mock-durable-object-id',
      }),
      POSTGRES_CONNECTION_STRING: 'postgresql://test:test@localhost/test',
    };
  });

  it('lets a person stop the turn they are watching', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

    const response = await handleRealtimeRoutes(
      stopRequest({ turnId: 'turn-1' }),
      mockEnv,
      principal('user'),
    );

    expect(response?.status).toBe(200);
    const forwarded = mockStub.fetch.mock.calls[0][0] as Request;
    expect(await forwarded.json()).toMatchObject({ turnId: 'turn-1' });
  });

  it('lets a person stop the agent they can see', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

    const response = await handleRealtimeRoutes(
      stopRequest({ agentId: 'agent-7' }),
      mockEnv,
      principal('user'),
    );

    expect(response?.status).toBe(200);
    expect(mockStub.fetch).toHaveBeenCalled();
  });

  // Neither shape reaches the record: the agent id path records the turn id the session
  // reported, and the session reported whatever header the agent sent to reserve it.
  const shapes = [
    { as: 'a turn id', body: { turnId: 'turn-1' } },
    { as: 'an agent id', body: { agentId: 'agent-7' } },
    { as: 'both at once', body: { agentId: 'agent-7', turnId: 'turn-1' } },
  ];

  it.each(['agent', 'service'] as const)('refuses a %s principal', async (type) => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');

    for (const { as, body } of shapes) {
      const response = await handleRealtimeRoutes(stopRequest(body), mockEnv, principal(type));
      expect(response?.status, `naming ${as}`).toBe(403);
    }
    expect(mockStub.fetch).not.toHaveBeenCalled();
  });
});
