import { describe, it, expect, vi } from 'vitest';
import { persistEditSessions, parseStoredEditSessions } from '../../src/durable-objects/edit-session-store';
import { EDIT_SESSIONS_STORAGE_KEY, type EditSession } from '../../src/durable-objects/document-session-types';

function baseSession(overrides: Partial<EditSession> = {}): EditSession {
  return {
    id: 'session-1',
    ownerId: 'agent-123',
    ownerType: 'agent',
    trigger: 'human_requested',
    intent: 'Rewrite the intro',
    targetRegions: ['/content/0'],
    checkpointId: 'checkpoint-1',
    startedAt: 1_700_000_000_000,
    conflicted: false,
    conflictReason: undefined,
    ...overrides,
  };
}

async function roundTrip(sessions: Map<string, EditSession>): Promise<Map<string, EditSession>> {
  const storageData = new Map<string, unknown>();
  const storage = {
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      storageData.set(key, value);
      return Promise.resolve();
    }),
  } as unknown as DurableObjectStorage;

  await persistEditSessions(storage, sessions);
  return parseStoredEditSessions(storageData.get(EDIT_SESSIONS_STORAGE_KEY));
}

describe('edit session store: turnId round trip', () => {
  it('carries turnId through a persist/restore round trip', async () => {
    const sessions = new Map<string, EditSession>([
      ['agent-1', baseSession({ turnId: 'turn-abc' })],
    ]);

    const restored = await roundTrip(sessions);

    expect(restored.get('agent-1')?.turnId).toBe('turn-abc');
  });
});
