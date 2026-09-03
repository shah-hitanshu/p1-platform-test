/**
 * A locale that is not a string is refused at the route with a 400, like any
 * other malformed body. Reaching the service with a non-string throws inside
 * the language-tag parser, which no error arm maps, so the caller would see a
 * 500 for a bad request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';

vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getBranch: vi.fn(),
    getMainBranch: vi.fn(),
    createDocumentOnBranch: vi.fn(),
  };
});

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  getEffectiveRole: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
  },
}));

const featureBranch = makeBranch({
  id: 'branch-1',
  siteId: 'site-1',
  name: 'feature',
  status: 'active',
  isMain: false,
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-24T10:00:00.000Z',
  updatedAt: '2026-01-24T10:00:00.000Z',
});

function postCreateRequest(body: Record<string, unknown>): Request {
  return new Request(
    'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

const context = {
  siteId: 'site-1',
  branchId: 'branch-1',
  principal: makePrincipal({ id: 'user-1', type: 'user' }),
};

describe('POST create document with a malformed locale', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['an object', { tag: 'fr-FR' }],
    ['an empty string', ''],
  ])('answers 400 when the locale is %s', async (_label, locale) => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(featureBranch);

    const response = await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/x', locale }),
      context,
    );

    expect(response.status).toBe(400);
    expect(services.createDocumentOnBranch).not.toHaveBeenCalled();
  });
});
