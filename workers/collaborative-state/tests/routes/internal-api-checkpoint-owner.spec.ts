/**
 * Session-checkpoint owner handling on the internal API.
 *
 * The internal checkpoint endpoints accept an owner so a session belonging to a
 * signed-in person is attributed to them. A body carrying only agentId keeps its
 * original agent-owned meaning.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {
    branchId: string;
    constructor(branchId: string) {
      super(`Branch not found: ${branchId}`);
      this.branchId = branchId;
    }
  },
  CheckpointNotFoundError: class CheckpointNotFoundError extends Error {
    checkpointId: string;
    constructor(checkpointId: string) {
      super(`Checkpoint not found: ${checkpointId}`);
      this.checkpointId = checkpointId;
    }
  },
}));

import {
  createCheckpoint,
  revertToCheckpoint,
} from '../../src/services/checkpoint-service';
import { handleInternalRoutes } from '../../src/routes/internal-api';

const SECRET = 'correct-secret';

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': SECRET,
    },
    body: JSON.stringify(body),
  });
}

function createCheckpointArgs(): Record<string, unknown> {
  const call = vi.mocked(createCheckpoint).mock.calls[0];
  expect(call).toBeDefined();
  return call?.[0] as unknown as Record<string, unknown>;
}

function revertArgs(): Record<string, unknown> {
  const call = vi.mocked(revertToCheckpoint).mock.calls[0];
  expect(call).toBeDefined();
  return call?.[0] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createCheckpoint).mockResolvedValue({
    checkpoint: { id: 'checkpoint-1' },
    documentCount: 1,
  } as unknown as Awaited<ReturnType<typeof createCheckpoint>>);
  vi.mocked(revertToCheckpoint).mockResolvedValue({
    checkpoint: { id: 'checkpoint-1' },
    documentsReverted: 1,
    documentsSkipped: 0,
  } as unknown as Awaited<ReturnType<typeof revertToCheckpoint>>);
});

describe('POST /internal/agent-checkpoint-start with an owner', () => {
  it('attributes a person-owned session to that person', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-start', {
        branchId: 'branch-1',
        ownerId: 'user-1',
        ownerType: 'user',
        intent: 'Rewrite the hero copy',
        trigger: 'manual',
        targetRegions: ['/content/0'],
        forceFullSnapshot: true,
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(200);
    const args = createCheckpointArgs();
    expect(args.checkpointType).toBe('session_pre_edit');
    expect(args.createdByType).toBe('user');
    expect(args.createdById).toBe('user-1');
  });

  it('keeps agent attribution for a body carrying only agentId', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-start', {
        branchId: 'branch-1',
        agentId: 'agent-1',
        intent: 'Optimise headings',
        trigger: 'autonomous',
        targetRegions: ['/content/0'],
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(200);
    const args = createCheckpointArgs();
    expect(args.checkpointType).toBe('session_pre_edit');
    expect(args.createdByType).toBe('agent');
    expect(args.createdById).toBe('agent-1');
  });

  it('rejects a body naming no owner at all', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-start', {
        branchId: 'branch-1',
        intent: 'Rewrite the hero copy',
        trigger: 'manual',
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain('agentId');
  });

  it('rejects an unknown owner type', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-start', {
        branchId: 'branch-1',
        ownerId: 'user-1',
        ownerType: 'robot',
        intent: 'Rewrite the hero copy',
        trigger: 'manual',
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain('ownerType');
  });

  it('rejects an owner id given without an owner type', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-start', {
        branchId: 'branch-1',
        ownerId: 'user-1',
        intent: 'Rewrite the hero copy',
        trigger: 'manual',
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain('ownerType');
  });
});

describe('POST /internal/agent-checkpoint-complete with an owner', () => {
  it('attributes a person-owned session to that person', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-complete', {
        branchId: 'branch-1',
        ownerId: 'user-1',
        ownerType: 'user',
        intent: 'Rewrite the hero copy',
        preEditCheckpointId: 'checkpoint-pre',
        affectedRegions: ['/content/0'],
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(200);
    const args = createCheckpointArgs();
    expect(args.checkpointType).toBe('session_post_edit');
    expect(args.createdByType).toBe('user');
    expect(args.createdById).toBe('user-1');
  });

  it('keeps agent attribution for a body carrying only agentId', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-complete', {
        branchId: 'branch-1',
        agentId: 'agent-1',
        intent: 'Optimise headings',
        preEditCheckpointId: 'checkpoint-pre',
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(200);
    const args = createCheckpointArgs();
    expect(args.checkpointType).toBe('session_post_edit');
    expect(args.createdByType).toBe('agent');
  });
});

describe('POST /internal/agent-checkpoint-rollback with an owner', () => {
  it('attributes a person-owned rollback to that person', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-rollback', {
        checkpointId: 'checkpoint-1',
        ownerId: 'user-1',
        ownerType: 'user',
        reason: 'Aborted by the author',
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(200);
    const args = revertArgs();
    expect(args.createdByType).toBe('user');
    expect(args.createdById).toBe('user-1');
  });

  it('keeps agent attribution for a body carrying only agentId', async () => {
    const response = await handleInternalRoutes(
      post('/internal/agent-checkpoint-rollback', {
        checkpointId: 'checkpoint-1',
        agentId: 'agent-1',
        reason: 'Conflict detected',
      }),
      { internalSecret: SECRET },
    );

    expect(response.status).toBe(200);
    const args = revertArgs();
    expect(args.createdByType).toBe('agent');
    expect(args.createdById).toBe('agent-1');
  });
});
