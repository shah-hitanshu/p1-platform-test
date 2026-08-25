/**
 * PCC-3458 (scope extension per ticket comment, 2026-07-22 log sweep):
 * presence routes must resolve branch NAMES to the canonical branch UUID.
 *
 * WHY (Rule 9): ~960 requests/week hit GET /branches/main/presence — mostly
 * our own frontend on main-branch views. The handler passes the raw ref into
 * getBranchPresence/canViewBranch, so name-based presence reads are answered
 * from the wrong (name-keyed/empty) side and report "nobody editing" while
 * editors are active — silently wrong data, no error. Branch names are
 * contract-legal API input (~18k events/7d on REST routes resolve them fine);
 * presence must resolve them too, not reject them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BranchPresence } from '../../src/types';

vi.mock('../../src/services/presence-rollup-service', () => ({
  getBranchPresence: vi.fn(),
  getSitePresence: vi.fn(),
  getAgentPresence: vi.fn(),
  queryDocumentPresence: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {
    name = 'BranchNotFoundError';
    constructor(public branchId: string) {
      super(`Branch with ID "${branchId}" not found.`);
    }
  },
  SiteNotFoundError: class SiteNotFoundError extends Error {
    name = 'SiteNotFoundError';
    constructor(public siteId: string) {
      super(`Site with ID "${siteId}" not found.`);
    }
  },
  AgentNotFoundError: class AgentNotFoundError extends Error {
    name = 'AgentNotFoundError';
    constructor(public agentId: string) {
      super(`Agent with ID "${agentId}" not found.`);
    }
  },
}));

vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
  getMainBranch: vi.fn(),
}));

vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

import * as branchService from '../../src/services/branch-service';
import { hasPermission } from '../../src/auth/authorization';
import { readJson } from '../helpers/http';
import { makeBranch } from '../helpers/branch';

// Production-shaped identifiers (PCC-3462).
const SITE_ID = 'b4ce1f14-c196-4ac1-a287-68f90e321f18';
const MAIN_BRANCH_ID = '23411882-fe64-481f-b972-a670d9a5ff67';

const mainBranch = makeBranch({
  id: MAIN_BRANCH_ID,
  siteId: SITE_ID,
  name: 'main',
  isMain: true,
  createdAt: new Date().toISOString(),
  archivedAt: null,
});

function mockPresence(): BranchPresence {
  return {
    branchId: MAIN_BRANCH_ID,
    branchName: 'main',
    siteId: SITE_ID,
    summary: { totalActors: 1, humanCount: 1, agentCount: 0, editingCount: 1 },
    actors: [
      {
        id: 'presence-1',
        actorId: '11111111-2222-3333-4444-555555555555',
        actorType: 'user',
        role: 'human',
        name: 'Editing Human',
        state: 'editing',
        lastActivityAt: new Date().toISOString(),
        joinedAt: new Date().toISOString(),
      },
    ],
    documentSummary: [],
  };
}

const principal = {
  id: '11111111-2222-3333-4444-555555555555',
  type: 'user' as const,
  pantheonSiteRoles: { [SITE_ID]: 'developer' },
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(hasPermission).mockResolvedValue(true);
});

describe('PCC-3458: branch-ref resolution on presence routes', () => {
  it('resolves a branch NAME and queries presence with the canonical UUID (the ~960/week frontend case)', async () => {
    const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
    const presenceService = await import('../../src/services/presence-rollup-service');

    vi.mocked(branchService.getBranchByName).mockResolvedValue(mainBranch);
    vi.mocked(presenceService.getBranchPresence).mockResolvedValueOnce(mockPresence());

    const request = new Request(
      `https://api.example.com/api/sites/${SITE_ID}/branches/main/presence`,
      { method: 'GET' },
    );

    const response = await handlePresenceRoutes(
      request,
      { siteId: SITE_ID, branchId: 'main', principal },
      {},
    );

    expect(response.status).toBe(200);
    // THE assertion: the rollup query runs with the branch UUID, never the
    // literal name — so it reads the side where real sessions live.
    expect(presenceService.getBranchPresence).toHaveBeenCalledWith(
      expect.anything(),
      SITE_ID,
      MAIN_BRANCH_ID,
    );
    const body = (await readJson(response));
    expect(body.summary.totalActors).toBe(1);
  });

  it('still serves presence by branch UUID (existing behavior preserved)', async () => {
    const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
    const presenceService = await import('../../src/services/presence-rollup-service');

    vi.mocked(branchService.getBranch).mockResolvedValue(mainBranch);
    vi.mocked(presenceService.getBranchPresence).mockResolvedValueOnce(mockPresence());

    const request = new Request(
      `https://api.example.com/api/sites/${SITE_ID}/branches/${MAIN_BRANCH_ID}/presence`,
      { method: 'GET' },
    );

    const response = await handlePresenceRoutes(
      request,
      { siteId: SITE_ID, branchId: MAIN_BRANCH_ID, principal },
      {},
    );

    expect(response.status).toBe(200);
    expect(presenceService.getBranchPresence).toHaveBeenCalledWith(
      expect.anything(),
      SITE_ID,
      MAIN_BRANCH_ID,
    );
  });

  it('returns 404 for an unknown branch name without querying presence', async () => {
    const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
    const presenceService = await import('../../src/services/presence-rollup-service');

    vi.mocked(branchService.getBranchByName).mockResolvedValue(null);

    const request = new Request(
      `https://api.example.com/api/sites/${SITE_ID}/branches/no-such-branch/presence`,
      { method: 'GET' },
    );

    const response = await handlePresenceRoutes(
      request,
      { siteId: SITE_ID, branchId: 'no-such-branch', principal },
      {},
    );

    expect(response.status).toBe(404);
    expect(presenceService.getBranchPresence).not.toHaveBeenCalled();
  });

  it('resolves a branch NAME on document-level presence too', async () => {
    const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
    const presenceService = await import('../../src/services/presence-rollup-service');

    vi.mocked(branchService.getBranchByName).mockResolvedValue(mainBranch);
    vi.mocked(presenceService.queryDocumentPresence).mockResolvedValueOnce([]);

    const request = new Request(
      `https://api.example.com/api/sites/${SITE_ID}/branches/main/documents/home/presence`,
      { method: 'GET' },
    );

    const response = await handlePresenceRoutes(
      request,
      { siteId: SITE_ID, branchId: 'main', documentPath: 'home', principal },
      {},
    );

    expect(response.status).toBe(200);
    expect(presenceService.queryDocumentPresence).toHaveBeenCalledWith(
      expect.anything(),
      SITE_ID,
      'home',
      MAIN_BRANCH_ID,
    );
  });
});
