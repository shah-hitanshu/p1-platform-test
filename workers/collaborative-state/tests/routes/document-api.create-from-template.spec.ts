/**
 * Creating a document from a template: the backend builds version 1's snapshot
 * from the template so the page inherits the template's component slot ids,
 * rather than trusting a client-supplied snapshot.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real buildDocumentSkeletonFromTemplate runs against the mocked template
// snapshot; every database-backed service stays a stub.
vi.mock('../../src/services', async () => {
  const skeleton = await vi.importActual<
    typeof import('../../src/services/document-skeleton')
  >('../../src/services/document-skeleton');
  return {
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
    getBranch: vi.fn(),
    getMainBranch: vi.fn(),
    getLatestDocumentVersion: vi.fn(),
    getLatestDocumentVersionWithFallback: vi.fn(),
    getDocumentVersion: vi.fn(),
    listDocumentVersions: vi.fn(),
    createDocumentVersion: vi.fn(),
    reconstructVersionSnapshot: vi.fn(),
    buildDocumentSkeletonFromTemplate: skeleton.buildDocumentSkeletonFromTemplate,
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
  };
});

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  getEffectiveRole: vi.fn(),
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

const TEMPLATE_ID = 'tpl-1';
const TEMPLATE_VERSION_NUMBER = 7;
const HERO_SLOT_ID = 'HeroBlock-aaaa';

const featureBranch = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'feature',
  status: 'active',
  isMain: false,
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-24T10:00:00.000Z',
  updatedAt: '2026-01-24T10:00:00.000Z',
};

const mainBranch = {
  id: 'main-branch',
  siteId: 'site-1',
  name: 'main',
  status: 'active',
  isMain: true,
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-24T10:00:00.000Z',
  updatedAt: '2026-01-24T10:00:00.000Z',
};

// Content-shaped template snapshot whose component carries a stable slot id and
// whose root props hold template-authoring metadata that must not survive.
const templateSnapshot = {
  content: [
    { type: 'HeroBlock', props: { id: HERO_SLOT_ID, heading: 'Welcome' } },
  ],
  zones: {},
  root: { props: { name: 'Marketing template', _template: { id: TEMPLATE_ID } } },
};

const templateLatestVersion = {
  id: 'template-version-1',
  documentId: TEMPLATE_ID,
  branchId: 'branch-1',
  versionNumber: TEMPLATE_VERSION_NUMBER,
  snapshot: templateSnapshot,
  source: 'edit',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-24T10:00:00.000Z',
};

const createdResult = {
  document: {
    id: 'doc-new',
    siteId: 'site-1',
    path: 'pages/new-page',
    createdAt: '2026-01-24T12:00:00.000Z',
  },
  version: {
    id: 'version-1',
    documentId: 'doc-new',
    branchId: 'branch-1',
    versionNumber: 1,
    snapshot: {},
    source: 'edit',
    createdById: 'user-1',
    createdByType: 'user',
    createdAt: '2026-01-24T12:00:00.000Z',
  },
};

interface BuiltSnapshot {
  content?: { type: string; props: { id: string } }[];
  zones?: Record<string, unknown>;
  root?: { props: Record<string, unknown> };
}

function postCreateRequest(body: Record<string, unknown>): Request {
  return new Request(
    'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('POST create-from-template on branch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('preserves the template component slot ids in the built snapshot', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      version: templateLatestVersion,
      inherited: false,
    });
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult);

    const response = await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/new-page', templateId: TEMPLATE_ID }),
      { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
    );

    expect(response.status).toBe(201);
    const callArg = vi.mocked(services.createDocumentOnBranch).mock.calls[0]?.[0];
    const snapshot = callArg?.snapshot as BuiltSnapshot | undefined;
    expect(snapshot?.content?.[0]?.type).toBe('HeroBlock');
    expect(snapshot?.content?.[0]?.props.id).toBe(HERO_SLOT_ID);
  });

  it('passes the template synced version as templateVersion', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      version: templateLatestVersion,
      inherited: false,
    });
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult);

    await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/new-page', templateId: TEMPLATE_ID }),
      { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
    );

    const callArg = vi.mocked(services.createDocumentOnBranch).mock.calls[0]?.[0];
    expect(callArg?.templateVersion).toBe(TEMPLATE_VERSION_NUMBER);
  });

  it('rejects a request that supplies both a templateId and a snapshot', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      version: templateLatestVersion,
      inherited: false,
    });

    const response = await handleDocumentRoutes(
      postCreateRequest({
        path: 'pages/new-page',
        templateId: TEMPLATE_ID,
        snapshot: { content: [{ type: 'Injected', props: { id: 'Injected-zzzz' } }], zones: {}, root: { props: {} } },
      }),
      { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
    );

    expect(response.status).toBe(400);
    expect(services.createDocumentOnBranch).not.toHaveBeenCalled();
  });

  it('creates from a template without a snapshot and passes the built skeleton', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      version: templateLatestVersion,
      inherited: false,
    });
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult);

    const response = await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/new-page', templateId: TEMPLATE_ID }),
      { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
    );

    expect(response.status).toBe(201);
    const callArg = vi.mocked(services.createDocumentOnBranch).mock.calls[0]?.[0];
    const snapshot = callArg?.snapshot as BuiltSnapshot | undefined;
    expect(snapshot).toBeDefined();
    expect(Array.isArray(snapshot?.content)).toBe(true);
    expect(snapshot?.root?.props).toBeDefined();
  });

  it('seeds the built snapshot root title from the request title', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      version: templateLatestVersion,
      inherited: false,
    });
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult);

    await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/new-page', templateId: TEMPLATE_ID, title: 'My Homepage' }),
      { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
    );

    const callArg = vi.mocked(services.createDocumentOnBranch).mock.calls[0]?.[0];
    const snapshot = callArg?.snapshot as BuiltSnapshot | undefined;
    expect(snapshot?.root?.props.title).toBe('My Homepage');
  });

  it('passes a client snapshot through unchanged when no templateId is given', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult);

    const clientSnapshot = {
      content: [{ type: 'RichText', props: { id: 'RichText-bbbb', text: 'hand authored' } }],
      zones: {},
      root: { props: { title: 'Blank page' } },
    };

    const response = await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/new-page', snapshot: clientSnapshot }),
      { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
    );

    expect(response.status).toBe(201);
    const callArg = vi.mocked(services.createDocumentOnBranch).mock.calls[0]?.[0];
    expect(callArg?.templateId).toBeUndefined();
    expect(callArg?.snapshot).toEqual(clientSnapshot);
  });

  it('builds from a template that lives on main when creating on a feature branch', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    // The template is not copied onto the feature branch, so the branch-local
    // lookup finds nothing; the copy-on-write fallback resolves it from main.
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce(null);
    vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      version: templateLatestVersion,
      inherited: true,
    });
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult);

    const response = await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/new-page', templateId: TEMPLATE_ID }),
      { siteId: 'site-1', branchId: 'branch-1', principal: { id: 'user-1', type: 'user' } },
    );

    expect(response.status).toBe(201);
    const callArg = vi.mocked(services.createDocumentOnBranch).mock.calls[0]?.[0];
    const snapshot = callArg?.snapshot as BuiltSnapshot | undefined;
    expect(snapshot?.content?.[0]?.type).toBe('HeroBlock');
    expect(snapshot?.content?.[0]?.props.id).toBe(HERO_SLOT_ID);
  });
});
