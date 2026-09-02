/**
 * The merge job runner gate, as assembled at dispatch.
 *
 * The gate is two conditions ANDed, and the order matters: the MERGE_WORKFLOW binding is
 * checked first so a lane without the workflow never consults LaunchDarkly and can never be
 * talked onto a path it cannot execute.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const merge = vi.hoisted(() => ({ handleMergeRoutes: vi.fn() }));

vi.mock('../../src/routes/merge-api', () => ({
  handleMergeRoutes: merge.handleMergeRoutes,
}));

vi.mock('../../src/utils/branch-ref', () => ({
  resolveBranchRef: vi.fn(async (_siteId: string, branchId: string) => ({
    resolved: true,
    branchId,
  })),
}));

import {
  P1FeatureFlagService,
  P1_FEATURE_FLAG_CONFIGURATIONS,
} from '@pantheon-systems/p1-feature-flags';

import { dispatchRoute } from '../../src/routes/route-dispatch';
import type { Env } from '../../src/env';
import type { AuthenticatedPrincipal } from '../../src/types';

const SITE_ID = 'site-123';
const WORKFLOW = {} as NonNullable<Env['MERGE_WORKFLOW']>;

const principal = { id: 'user-1', type: 'user' } as unknown as AuthenticatedPrincipal;

function envWith(overrides: Partial<Env> = {}): Env {
  return { CONFIG_KV: {}, SESSION_KV: {}, ...overrides } as unknown as Env;
}

async function dispatchMergeExecute(env: Env): Promise<void> {
  await dispatchRoute(
    new Request('https://example.test/api/sites/site-123/merge/execute', { method: 'POST' }),
    { handler: 'merge', params: { siteId: SITE_ID, action: 'execute' } },
    principal,
    env,
    undefined,
  );
}

/** The gate as handleMergeRoutes actually received it. */
function gateAsPassed(): boolean {
  const [, context] = merge.handleMergeRoutes.mock.calls[0] as [
    Request,
    { mergeJobRunnerEnabled: boolean },
  ];
  return context.mergeJobRunnerEnabled;
}

const isEnabled = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  merge.handleMergeRoutes.mockResolvedValue(new Response('ok'));
  isEnabled.mockResolvedValue(true);
  // Stubbed at `init`, which is what the gate calls: stubbing `current` instead would pass
  // whether or not the gate initializes, which is the part worth pinning.
  vi.spyOn(P1FeatureFlagService, 'init').mockReturnValue({
    isEnabled,
  } as unknown as P1FeatureFlagService);
});

describe('merge dispatch gate', () => {
  it('is on when the flag is on and the workflow binding exists', async () => {
    await dispatchMergeExecute(envWith({ MERGE_WORKFLOW: WORKFLOW }));
    expect(gateAsPassed()).toBe(true);
  });

  it('is off when the flag is off, even with the binding present', async () => {
    isEnabled.mockResolvedValue(false);
    await dispatchMergeExecute(envWith({ MERGE_WORKFLOW: WORKFLOW }));
    expect(gateAsPassed()).toBe(false);
  });

  it('is off without the workflow binding, however the flag is set', async () => {
    isEnabled.mockResolvedValue(true);
    await dispatchMergeExecute(envWith());
    expect(gateAsPassed()).toBe(false);
  });

  it('does not consult LaunchDarkly when the workflow binding is absent', async () => {
    await dispatchMergeExecute(envWith());
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('initializes the service with the request bindings rather than reading the singleton', async () => {
    const env = envWith({ MERGE_WORKFLOW: WORKFLOW });
    await dispatchMergeExecute(env);

    // The bindings are in hand at the gate. Reading the singleton instead would resolve to
    // fallbacks in any entrypoint that had not initialized first.
    expect(P1FeatureFlagService.init).toHaveBeenCalledWith(env, undefined);
  });

  it('evaluates against the site in the route', async () => {
    await dispatchMergeExecute(envWith({ MERGE_WORKFLOW: WORKFLOW }));
    expect(isEnabled).toHaveBeenCalledWith(
      P1_FEATURE_FLAG_CONFIGURATIONS.mergeJobRunner,
      SITE_ID,
    );
  });
});
