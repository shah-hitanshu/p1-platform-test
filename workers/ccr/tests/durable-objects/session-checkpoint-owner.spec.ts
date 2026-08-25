/**
 * Checkpoint attribution for the actor that owns an edit session.
 *
 * Both edit boundaries carry the same checkpoint type whoever owns the session;
 * the owner determines created_by_type, created_by_id, and the trigger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  runWithConnection: vi.fn(),
}));

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
}));

import { runWithConnection } from '../../src/db';
import {
  createCheckpoint,
  revertToCheckpoint,
} from '../../src/services/checkpoint-service';
import {
  createSessionPreEditCheckpoint,
  createSessionPostEditCheckpoint,
  rollbackToSessionCheckpoint,
} from '../../src/durable-objects/session-checkpoint-client';
import type {
  DocumentSessionEnv,
  SessionInfo,
} from '../../src/durable-objects/document-session-types';

const sessionInfo: SessionInfo = {
  siteId: 'site-1',
  documentId: 'doc-1',
  branchId: 'branch-1',
};

/** Env whose Hyperdrive binding routes checkpoint writes through the direct path. */
const hyperdriveEnv = {
  HYPERDRIVE: { connectionString: 'postgres://test' },
} as unknown as DocumentSessionEnv;

/** Env with no Hyperdrive, forcing the HTTP internal-API fallback. */
const httpEnv = {
  INTERNAL_API_URL: 'http://internal',
  INTERNAL_SECRET: 'secret',
} as unknown as DocumentSessionEnv;

/** Arguments the direct path passed to createCheckpoint. */
function createCheckpointArgs(): Record<string, unknown> {
  const call = vi.mocked(createCheckpoint).mock.calls[0];
  expect(call).toBeDefined();
  return call?.[0] as unknown as Record<string, unknown>;
}

/** Arguments the direct path passed to revertToCheckpoint. */
function revertArgs(): Record<string, unknown> {
  const call = vi.mocked(revertToCheckpoint).mock.calls[0];
  expect(call).toBeDefined();
  return call?.[0] as unknown as Record<string, unknown>;
}

/** Body the HTTP fallback posted to the internal API. */
function postedBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  const init = call?.[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Run the callback the direct path wraps in a connection.
  vi.mocked(runWithConnection).mockImplementation(
    async (_conn: unknown, _opts: unknown, callback: () => Promise<unknown>) => callback(),
  );
  vi.mocked(createCheckpoint).mockResolvedValue({
    checkpoint: { id: 'checkpoint-1' },
    documentCount: 1,
  } as unknown as Awaited<ReturnType<typeof createCheckpoint>>);
  vi.mocked(revertToCheckpoint).mockResolvedValue({
    documentsReverted: 2,
    documentsSkipped: 0,
  } as unknown as Awaited<ReturnType<typeof revertToCheckpoint>>);
});

describe('pre-edit checkpoint', () => {
  it('attributes a person-owned session to that person', async () => {
    await createSessionPreEditCheckpoint(
      hyperdriveEnv,
      sessionInfo,
      { id: 'user-1', type: 'user' },
      'Rewrite the hero copy',
      'manual',
      ['/content/0'],
    );

    const args = createCheckpointArgs();
    expect(args.checkpointType).toBe('session_pre_edit');
    expect(args.createdByType).toBe('user');
    expect(args.createdById).toBe('user-1');
    expect(args.trigger).toBe('manual');
  });

  it('attributes an agent-owned session to that agent', async () => {
    await createSessionPreEditCheckpoint(
      hyperdriveEnv,
      sessionInfo,
      { id: 'agent-1', type: 'agent' },
      'Optimise headings',
      'autonomous',
      ['/content/0'],
    );

    const args = createCheckpointArgs();
    expect(args.checkpointType).toBe('session_pre_edit');
    expect(args.createdByType).toBe('agent');
    expect(args.createdById).toBe('agent-1');
    expect(args.trigger).toBe('autonomous');
  });

  it('captures a delta, leaving completeness to chain resolution', async () => {
    await createSessionPreEditCheckpoint(
      hyperdriveEnv,
      sessionInfo,
      { id: 'user-1', type: 'user' },
      'Rewrite the hero copy',
      'manual',
      ['/content/0'],
    );

    // A rollback still restores the whole branch — resolving the parent chain
    // is what makes that true, so the manifest no longer sweeps every document.
    expect(createCheckpointArgs().forceFullSnapshot).toBeUndefined();
  });

  it('forwards the owner to the internal API when there is no direct connection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ checkpointId: 'checkpoint-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createSessionPreEditCheckpoint(
      httpEnv,
      sessionInfo,
      { id: 'user-1', type: 'user' },
      'Rewrite the hero copy',
      'manual',
      ['/content/0'],
    );

    const body = postedBody(fetchMock);
    expect(body.ownerId).toBe('user-1');
    expect(body.ownerType).toBe('user');

    vi.unstubAllGlobals();
  });
});

describe('post-edit checkpoint', () => {
  it('attributes a person-owned session to that person', async () => {
    await createSessionPostEditCheckpoint(
      hyperdriveEnv,
      sessionInfo,
      { id: 'user-1', type: 'user' },
      'Rewrite the hero copy',
      'checkpoint-pre',
      ['/content/0'],
    );

    const args = createCheckpointArgs();
    expect(args.checkpointType).toBe('session_post_edit');
    expect(args.createdByType).toBe('user');
    expect(args.createdById).toBe('user-1');
    expect(args.trigger).toBe('manual');
  });

  it('attributes an agent-owned session to that agent', async () => {
    await createSessionPostEditCheckpoint(
      hyperdriveEnv,
      sessionInfo,
      { id: 'agent-1', type: 'agent' },
      'Optimise headings',
      'checkpoint-pre',
      ['/content/0'],
    );

    const args = createCheckpointArgs();
    expect(args.checkpointType).toBe('session_post_edit');
    expect(args.createdByType).toBe('agent');
    expect(args.trigger).toBe('autonomous');
  });
});

describe('rollback', () => {
  it('attributes a person\'s rollback to that person', async () => {
    const rolledBack = await rollbackToSessionCheckpoint(
      hyperdriveEnv,
      sessionInfo,
      'checkpoint-1',
      { id: 'user-1', type: 'user' },
      'Aborted by the author',
    );

    expect(rolledBack).toBe(true);
    const args = revertArgs();
    expect(args.createdByType).toBe('user');
    expect(args.createdById).toBe('user-1');
    expect(args.message).toBe('Aborted by the author');
  });

  it('attributes an agent\'s rollback to that agent', async () => {
    await rollbackToSessionCheckpoint(
      hyperdriveEnv,
      sessionInfo,
      'checkpoint-1',
      { id: 'agent-1', type: 'agent' },
      'Conflict detected',
    );

    const args = revertArgs();
    expect(args.createdByType).toBe('agent');
    expect(args.createdById).toBe('agent-1');
  });

  it('forwards the owner to the internal API when there is no direct connection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ rolledBack: true, documentsReverted: 1 }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await rollbackToSessionCheckpoint(
      httpEnv,
      sessionInfo,
      'checkpoint-1',
      { id: 'user-1', type: 'user' },
      'Aborted by the author',
    );

    const body = postedBody(fetchMock);
    expect(body.ownerId).toBe('user-1');
    expect(body.ownerType).toBe('user');

    vi.unstubAllGlobals();
  });
});
