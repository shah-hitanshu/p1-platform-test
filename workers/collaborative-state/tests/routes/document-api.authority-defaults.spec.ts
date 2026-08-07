/**
 * Authority defaults on the authority-override routes: a translation serves the
 * per-slot defaults declared by its canonical's template alongside its own
 * per-prop overrides, plus the authority a slot named by neither falls back to, so
 * a client can resolve a prop's effective authority without reading the template.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Authority } from '@pantheon-systems/p1-content-validator';
import { makeBranch } from '../helpers/branch';
import { makePrincipal } from '../helpers/principal';
import { readJson } from '../helpers/http';
import type { DocumentRouteContext } from '../../src/routes/document-api';

vi.mock('../../src/services', () => ({
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
  getLocalizationEdgeBySource: vi.fn(),
  getAuthorityOverrides: vi.fn(),
  resolveSlotAuthorityDefaults: vi.fn(),
  authorityOverridesToJson: (
    overrides: Map<string, Map<string, string>>,
  ): Record<string, Record<string, string>> =>
    Object.fromEntries([...overrides].map(([slotId, props]) => [slotId, Object.fromEntries(props)])),
  setAuthorityOverride: vi.fn(),
  clearAuthorityOverride: vi.fn(),
  buildChangeSummary: vi.fn(),
  createTranslation: vi.fn(),
  listLocaleVariants: vi.fn(),
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByPath: vi.fn(),
  updateDocumentPath: vi.fn(),
  archiveDocument: vi.fn(),
  restoreDocument: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentsOnBranch: vi.fn(),
  createDocumentOnBranch: vi.fn(),
  documentExistsOnBranch: vi.fn(),
  deleteDocumentOnBranch: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  getLatestDocumentVersionWithFallback: vi.fn(),
  getDocumentVersion: vi.fn(),
  listDocumentVersions: vi.fn(),
  createDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
  publishDocument: vi.fn(),
  buildDocumentSkeletonFromTemplate: vi.fn(),
  SiteNotFoundError: class SiteNotFoundError extends Error {
    override name = 'SiteNotFoundError';
  },
  DuplicateDocumentPathError: class DuplicateDocumentPathError extends Error {
    override name = 'DuplicateDocumentPathError';
  },
  InvalidDocumentPathError: class InvalidDocumentPathError extends Error {
    override name = 'InvalidDocumentPathError';
  },
  DocumentNotFoundError: class DocumentNotFoundError extends Error {
    override name = 'DocumentNotFoundError';
  },
  DocumentPathConflictError: class DocumentPathConflictError extends Error {
    override name = 'DocumentPathConflictError';
  },
  InvalidDocumentVersionParamsError: class InvalidDocumentVersionParamsError extends Error {
    override name = 'InvalidDocumentVersionParamsError';
  },
  TranslationAlreadyExistsError: class TranslationAlreadyExistsError extends Error {
    override name = 'TranslationAlreadyExistsError';
  },
  InvalidLocaleError: class InvalidLocaleError extends Error {
    override name = 'InvalidLocaleError';
  },
  CanonicalVersionNotFoundError: class CanonicalVersionNotFoundError extends Error {
    override name = 'CanonicalVersionNotFoundError';
  },
}));

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  getEffectiveRole: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
  },
}));

vi.mock('./template-api', () => ({
  templateMetadata: vi.fn().mockReturnValue({}),
}));

const TRANSLATION_ID = '22222222-2222-2222-2222-222222222222';
const CANONICAL_ID = '33333333-3333-3333-3333-333333333333';

const featureBranch = makeBranch({
  id: 'branch-1',
  siteId: 'site-1',
  name: 'feature',
  isMain: false,
});

const localizationEdge = {
  id: 'edge-1',
  sourceDocumentId: TRANSLATION_ID,
  targetDocumentId: CANONICAL_ID,
  relationType: 'localization' as const,
  syncedVersion: 3,
  metadata: {},
  createdAt: '2026-01-24T11:00:00.000Z',
};

const overridesMap = new Map([['HeadingBlock-1', new Map([['title', 'locale' as const]])]]);

const slotDefaults: Record<string, Authority> = {
  'HeadingBlock-1': 'canonical',
  'ImageBlock-1': 'locale',
};

function authorityOverridesUrl(): string {
  return `https://api.example.com/api/sites/site-1/branches/branch-1/documents/${TRANSLATION_ID}/authority-overrides`;
}

const context: DocumentRouteContext = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentId: TRANSLATION_ID,
  action: 'authority-overrides' as const,
  principal: makePrincipal({ id: 'user-1', type: 'user' }),
};

async function callRoute(request: Request): Promise<Response> {
  const { handleDocumentRoutes } = await import('../../src/routes/document-api');
  return handleDocumentRoutes(request, context);
}

async function primeTranslation(defaults = slotDefaults): Promise<void> {
  const services = await import('../../src/services');
  vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
  vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
  vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);
  vi.mocked(services.getAuthorityOverrides).mockResolvedValueOnce(overridesMap);
  vi.mocked(services.resolveSlotAuthorityDefaults).mockResolvedValueOnce({
    slotDefaults: defaults,
    defaultAuthority: 'canonical',
  });
}

describe('GET authority-overrides slot defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves the canonical template's per-slot defaults with the stored overrides", async () => {
    await primeTranslation();

    const response = await callRoute(new Request(authorityOverridesUrl(), { method: 'GET' }));

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.authorityOverrides).toEqual({ 'HeadingBlock-1': { title: 'locale' } });
    expect(body.slotDefaults).toEqual(slotDefaults);
    expect(body.defaultAuthority).toBe('canonical');
  });

  it('resolves the defaults against the canonical, not the translation', async () => {
    await primeTranslation();
    const services = await import('../../src/services');

    await callRoute(new Request(authorityOverridesUrl(), { method: 'GET' }));

    expect(services.resolveSlotAuthorityDefaults).toHaveBeenCalledWith(CANONICAL_ID, 'branch-1');
  });

  it('reports no slot defaults when the canonical has no template', async () => {
    await primeTranslation({});

    const response = await callRoute(new Request(authorityOverridesUrl(), { method: 'GET' }));

    const body = await readJson(response);
    expect(body.slotDefaults).toEqual({});
    expect(body.defaultAuthority).toBe('canonical');
  });
});

describe('authority-override mutations carry the slot defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the defaults alongside the map after setting an override', async () => {
    await primeTranslation();

    const response = await callRoute(
      new Request(authorityOverridesUrl(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: 'HeadingBlock-1',
          propName: 'title',
          authority: 'locale',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.slotDefaults).toEqual(slotDefaults);
    expect(body.defaultAuthority).toBe('canonical');
  });

  it('returns the defaults alongside the map after clearing an override', async () => {
    await primeTranslation();

    const response = await callRoute(
      new Request(authorityOverridesUrl(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'HeadingBlock-1', propName: 'title' }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.slotDefaults).toEqual(slotDefaults);
    expect(body.defaultAuthority).toBe('canonical');
  });
});
