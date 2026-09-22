import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type {
  ActorPresence, AgentStopResult, Branch, P1Client, PuckData,
} from '@pantheon-systems/css-client';

vi.mock('../src/editor/useRealtime.js', () => ({
  useRealtime: () => ({
    connected: false,
    applyLocalChange: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(null),
    error: null,
    sendFocusRegions: vi.fn().mockReturnValue(false),
    sendHeartbeat: vi.fn(),
    presenceViaWebSocket: false,
    connectedDocumentPath: null,
    waitForDelivery: vi.fn().mockResolvedValue(undefined),
    requestPublish: vi.fn().mockResolvedValue({ success: true }),
  }),
}));

const { P1PuckProvider } = await import('../src/editor/P1PuckProvider.js');
const { useP1Puck } = await import('../src/core/P1PuckContext.js');

const mockBranch: Branch = {
  id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const mockDocument = {
  id: 'doc-1', siteId: 'site-1', path: 'pages/home', title: 'Home',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const emptyData: PuckData = { content: [], root: { props: {} } };

const agentActor: ActorPresence = {
  id: 'presence-1', actorId: 'agent-1', actorType: 'agent', role: 'agent',
  name: 'Writer', state: 'editing',
  lastActivityAt: '2026-01-01T00:00:00Z', joinedAt: '2026-01-01T00:00:00Z',
};

function createMockClient(stopAgent: ReturnType<typeof vi.fn>): P1Client {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([mockBranch]),
      get: vi.fn().mockResolvedValue(mockBranch),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getByPath: vi.fn().mockResolvedValue(mockDocument),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getLatest: vi.fn().mockResolvedValue({ id: 'v1', versionNumber: 1, snapshot: emptyData }),
      create: vi.fn(),
    },
    checkpoints: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn() },
    presence: { getSitePresence: vi.fn(), getBranchPresence: vi.fn(), getAgentPresence: vi.fn() },
    agentRegistry: {
      list: vi.fn(), get: vi.fn(), create: vi.fn(),
      update: vi.fn(), updateStatus: vi.fn(), delete: vi.fn(),
    },
    agentEdit: {
      canEdit: vi.fn(), startEdit: vi.fn(), completeEdit: vi.fn(), abortEdit: vi.fn(), stopAgent,
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as P1Client;
}

/** The stop needs a document to address, so the helper opens one. */
async function renderProvider(stopResult: AgentStopResult = { success: true, rolledBack: true }) {
  const stopAgentSpy = vi.fn().mockResolvedValue(stopResult);
  const client = createMockClient(stopAgentSpy);

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1PuckProvider,
      // Presence off: a successful stop refreshes presence, and this spec is about
      // where the stop goes, not about what the presence mocks hand back.
      { client, siteId: 'site-1', branchId: 'branch-1', userId: 'user-1', presenceEnabled: false },
      children,
    );
  }

  const { result } = renderHook(() => useP1Puck(), { wrapper: Wrapper });
  await act(async () => { await result.current.loadDocument('/pages/home'); });

  return { result, stopAgentSpy };
}

describe('stopping an agent from the editor', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('calls a registered cancel and still posts the stop', async () => {
    const cancel = vi.fn();
    const { result, stopAgentSpy } = await renderProvider();
    result.current.registerAgentCancel(cancel);

    await act(async () => { await result.current.stopAgent(agentActor); });

    expect(cancel).toHaveBeenCalledOnce();
    expect(stopAgentSpy).toHaveBeenCalledWith('site-1', 'branch-1', 'pages/home', 'agent-1');
  });

  it('names the turn the agent is working on', async () => {
    // Without the turn, a stop landing between two edits bars nothing at all.
    const { result, stopAgentSpy } = await renderProvider();

    await act(async () => {
      await result.current.stopAgent({ ...agentActor, turnId: 'turn-abc' });
    });

    expect(stopAgentSpy).toHaveBeenCalledWith(
      'site-1', 'branch-1', 'pages/home', { agentId: 'agent-1', turnId: 'turn-abc' },
    );
  });

  // A single-slot registry serves every stop, including ones aimed at other people's
  // agents, so the registrant has to be told what is being stopped to answer for itself.
  it('tells the cancel what is being stopped', async () => {
    const cancel = vi.fn();
    const { result } = await renderProvider();
    result.current.registerAgentCancel(cancel);

    await act(async () => { await result.current.stopAgent(agentActor); });
    await act(async () => { await result.current.stopAgent({ turnId: 'turn-9' }); });

    expect(cancel).toHaveBeenNthCalledWith(1, agentActor);
    expect(cancel).toHaveBeenNthCalledWith(2, { turnId: 'turn-9' });
  });

  it('posts the stop when nothing is registered', async () => {
    const { result, stopAgentSpy } = await renderProvider();

    await act(async () => { await result.current.stopAgent(agentActor); });

    expect(stopAgentSpy).toHaveBeenCalledOnce();
  });

  it('stops calling a cancel that has unregistered', async () => {
    const cancel = vi.fn();
    const { result } = await renderProvider();
    const unregister = result.current.registerAgentCancel(cancel);
    unregister();

    await act(async () => { await result.current.stopAgent(agentActor); });

    expect(cancel).not.toHaveBeenCalled();
  });

  // The only case the ref-equality guard in registerAgentCancel exists for: a displaced
  // registrant unmounting must not take the live one down with it.
  it('leaves a later registration alone when an earlier one withdraws', async () => {
    const displaced = vi.fn();
    const live = vi.fn();
    const { result } = await renderProvider();
    const unregisterDisplaced = result.current.registerAgentCancel(displaced);
    result.current.registerAgentCancel(live);
    unregisterDisplaced();

    await act(async () => { await result.current.stopAgent(agentActor); });

    expect(live).toHaveBeenCalledOnce();
    expect(displaced).not.toHaveBeenCalled();
  });

  // The reported bug was a Stop that said it worked while the agent carried on. A stop
  // that found nothing to stop must not read the same as one that did.
  it('says the agent stopped only when the backend stopped one', async () => {
    const { result } = await renderProvider();

    await act(async () => { await result.current.stopAgent(agentActor); });

    expect(result.current.notifications.notifications).toContainEqual(
      expect.objectContaining({ severity: 'success', message: 'Zappy has been stopped' }),
    );
  });

  it('does not claim a stop when there was no turn to stop', async () => {
    const { result } = await renderProvider({
      success: false, rolledBack: false, reason: 'no_active_turn',
    });

    await act(async () => { await result.current.stopAgent(agentActor); });

    const notes = result.current.notifications.notifications;
    expect(notes).toContainEqual(
      expect.objectContaining({ severity: 'info', message: 'Zappy had already stopped' }),
    );
    expect(notes.some(n => n.severity === 'success')).toBe(false);
  });

  it('stops a turn named without an actor', async () => {
    const { result, stopAgentSpy } = await renderProvider();

    await act(async () => { await result.current.stopAgent({ turnId: 'turn-abc' }); });

    expect(stopAgentSpy).toHaveBeenCalledWith(
      'site-1', 'branch-1', 'pages/home', { turnId: 'turn-abc' },
    );
  });
});
