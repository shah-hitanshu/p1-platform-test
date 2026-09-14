/**
 * Publishing reads the document's latest version out of Postgres, so the
 * collaborative session's pending edits are written there first and a publish
 * that cannot write them is refused rather than shipping superseded content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';
import type { PublishDocumentResult } from '../../src/services/checkpoint-types';

vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getBranch: vi.fn(),
    getDocument: vi.fn(),
    documentExistsOnBranch: vi.fn(),
    publishDocument: vi.fn(),
  };
});

vi.mock('../../src/auth/authorization', async () => {
  const actual = await vi.importActual('../../src/auth/authorization');
  return { ...actual, assertPermission: vi.fn() };
});

const mainBranch = makeBranch({
  id: 'branch-main',
  siteId: 'site-1',
  name: 'main',
  status: 'active' as const,
  isMain: true,
  createdById: 'user-1',
  createdByType: 'user' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const principal = makePrincipal({ id: 'user-1', type: 'user', siteId: 'site-1' });

const publishResult: PublishDocumentResult = {
  checkpoint: {
    id: 'checkpoint-1',
    branchId: 'branch-main',
    checkpointType: 'publish',
    createdById: 'user-1',
    createdByType: 'user',
    createdAt: '2026-03-09T10:00:00.000Z',
  },
  publishedVersionId: 'version-1',
};

describe('Publishing a document', () => {
  let callOrder: string[];
  let sessionNames: string[];
  let flushStatus: number;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    callOrder = [];
    sessionNames = [];
    flushStatus = 200;
  });

  function makeBinding(): DurableObjectNamespace {
    return {
      idFromName: (name: string) => {
        sessionNames.push(name);
        return { name } as unknown as DurableObjectId;
      },
      get: () => ({
        fetch: (): Promise<Response> => {
          callOrder.push('flush');
          if (flushStatus !== 200) {
            return Promise.resolve(new Response('unavailable', { status: flushStatus }));
          }
          return Promise.resolve(
            new Response(JSON.stringify({ flushed: true }), { status: 200 }),
          );
        },
      }),
    } as unknown as DurableObjectNamespace;
  }

  async function publish(
    documentStateBinding?: DurableObjectNamespace,
  ): Promise<Response> {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');
    const { assertPermission } = await import('../../src/auth/authorization');

    vi.mocked(services.getBranch).mockResolvedValue(mainBranch);
    vi.mocked(services.getDocument).mockResolvedValue(null);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValue(true);
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(services.publishDocument).mockImplementation(async () => {
      callOrder.push('publish');
      return publishResult;
    });

    return await handleDocumentRoutes(
      new Request(
        'http://localhost/api/sites/site-1/branches/branch-main/documents/doc-1/publish',
        { method: 'POST' },
      ),
      {
        siteId: 'site-1',
        branchId: 'branch-main',
        documentId: 'doc-1',
        action: 'publish',
        principal,
        ...(documentStateBinding !== undefined ? { documentStateBinding } : {}),
      },
    );
  }

  it('writes the session to Postgres before reading the version to publish', async () => {
    const response = await publish(makeBinding());

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(['flush', 'publish']);
  });

  it('addresses the session holding the document on the branch being published', async () => {
    await publish(makeBinding());

    expect(sessionNames).toEqual(['site-1:doc-1:branch-main']);
  });

  it('refuses to publish when the session cannot be written', async () => {
    flushStatus = 503;

    const response = await publish(makeBinding());
    const services = await import('../../src/services');

    expect(response.status).toBe(503);
    expect(services.publishDocument).not.toHaveBeenCalled();
    const body = await readJson<{ error?: string }>(response);
    expect(body.error).toContain('could not be saved');
  });

  it('publishes the stored version when no session binding is configured', async () => {
    const response = await publish();

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(['publish']);
  });
});
