/**
 * The service's lifecycle and its reporting edges.
 *
 * `flags.spec.ts` covers resolution; what is left here is the behaviour a gate never sees but
 * a long-lived isolate depends on — that a replaced instance releases its client, that a
 * prewarm can never reject into `waitUntil`, and that one unsynced flag does not silence the
 * report for the next one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ld = vi.hoisted(() => ({
  init: vi.fn(),
  waitForInitialization: vi.fn(),
  variationDetail: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@launchdarkly/cloudflare-server-sdk', () => ({
  init: (...args: unknown[]) => {
    ld.init(...args);
    return {
      waitForInitialization: ld.waitForInitialization,
      variationDetail: ld.variationDetail,
      close: ld.close,
    };
  },
}));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', () => ({ getLogger: () => logger }));

import {
  P1FeatureFlagService,
  type FeatureFlagEnv,
  type FlagContextKind,
  type FlagStore,
  type P1FeatureFlag,
  type P1FlagKey,
} from '../src/index.js';

/** Keys chosen outside `P1FlagKey`: what is asserted here is machinery, not a live flag. */
function testFlag(key: string, fallback: boolean, contextKind: FlagContextKind): P1FeatureFlag {
  return { key: key as P1FlagKey, fallback, contextKind };
}

const FLAG = testFlag('p1-test-flag', false, 'site');
const OTHER_FLAG = testFlag('p1-test-other-flag', false, 'site');
const SITE_ID = 'site-123';

const KV = {} as FlagStore;

function configured(overrides: Partial<FeatureFlagEnv> = {}): FeatureFlagEnv {
  return { LD_KV: KV, LD_CLIENT_SIDE_ID: 'client-side-id', ENVIRONMENT: 'staging', ...overrides };
}

beforeEach(() => {
  P1FeatureFlagService.resetForTests();
  vi.clearAllMocks();
  ld.waitForInitialization.mockResolvedValue(undefined);
  ld.variationDetail.mockResolvedValue({ value: false, reason: { kind: 'OFF' } });
});

describe('FLAG_OVERRIDES that are valid JSON but not a flag map', () => {
  it('ignores a JSON null without reporting it as malformed', async () => {
    const flags = new P1FeatureFlagService(configured({ FLAG_OVERRIDES: 'null' }));
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);

    expect(logger.error).not.toHaveBeenCalled();
    expect(ld.variationDetail).toHaveBeenCalledTimes(1);
  });

  it('ignores a JSON scalar without reporting it as malformed', async () => {
    const flags = new P1FeatureFlagService(configured({ FLAG_OVERRIDES: '5' }));
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);

    expect(logger.error).not.toHaveBeenCalled();
    expect(ld.variationDetail).toHaveBeenCalledTimes(1);
  });

  it('falls through to LaunchDarkly when the var is empty', async () => {
    ld.variationDetail.mockResolvedValue({ value: true, reason: { kind: 'FALLTHROUGH' } });
    const flags = new P1FeatureFlagService(configured({ FLAG_OVERRIDES: '' }));

    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('close', () => {
  it('releases the LaunchDarkly client', async () => {
    const flags = new P1FeatureFlagService(configured());
    await flags.isEnabled(FLAG, SITE_ID);

    flags.close();

    expect(ld.close).toHaveBeenCalledTimes(1);
  });

  it('leaves the service usable, rebuilding a client on the next gate', async () => {
    const flags = new P1FeatureFlagService(configured());
    await flags.isEnabled(FLAG, SITE_ID);
    flags.close();

    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);
    expect(ld.init).toHaveBeenCalledTimes(2);
  });
});

describe('rebuilding on changed bindings', () => {
  it.each([
    ['the KV binding', { LD_KV: {} as FlagStore }],
    ['the client-side ID', { LD_CLIENT_SIDE_ID: 'other-id' }],
    ['the overrides', { FLAG_OVERRIDES: '{"p1-test-flag":true}' }],
    ['the lane', { ENVIRONMENT: 'production' }],
  ])('replaces the instance when %s changes', (_label, change) => {
    const first = P1FeatureFlagService.init(configured());
    const second = P1FeatureFlagService.init(configured(change));

    expect(second).not.toBe(first);
    expect(first.matches(configured(change))).toBe(false);
  });

  it('closes the instance it replaces, so its cache timer does not leak', async () => {
    const first = P1FeatureFlagService.init(configured());
    await first.isEnabled(FLAG, SITE_ID);

    P1FeatureFlagService.init(configured({ LD_CLIENT_SIDE_ID: 'other-id' }));

    expect(ld.close).toHaveBeenCalledTimes(1);
  });

  it('picks up a changed override, which is the deploy-to-recover path', async () => {
    const first = P1FeatureFlagService.init(configured());
    await expect(first.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);

    const recovered = P1FeatureFlagService.init(
      configured({ FLAG_OVERRIDES: '{"p1-test-flag":true}' }),
    );

    await expect(recovered.isEnabled(FLAG, SITE_ID)).resolves.toBe(true);
  });
});

describe('prewarm', () => {
  it('does not build a client when init is called without a context', () => {
    P1FeatureFlagService.init(configured());
    expect(ld.init).not.toHaveBeenCalled();
  });

  it('hands waitUntil a promise that resolves even when initialization fails', async () => {
    ld.waitForInitialization.mockRejectedValue(new Error('kv unavailable'));
    const waitUntil = vi.fn();

    P1FeatureFlagService.init(configured(), { waitUntil });

    // An unhandled rejection here would take down the request the prewarm rode in on.
    const [promise] = waitUntil.mock.calls[0] as [Promise<unknown>];
    await expect(promise).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('is silent and builds nothing when LaunchDarkly is unconfigured in a deployed lane', () => {
    const waitUntil = vi.fn();
    P1FeatureFlagService.init({ ENVIRONMENT: 'production' }, { waitUntil });

    expect(waitUntil).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('resetForTests', () => {
  it('closes the singleton it drops', async () => {
    const flags = P1FeatureFlagService.init(configured());
    await flags.isEnabled(FLAG, SITE_ID);

    P1FeatureFlagService.resetForTests();

    expect(ld.close).toHaveBeenCalledTimes(1);
  });
});

describe('reporting an unevaluable flag', () => {
  it('falls back to the reason kind when LaunchDarkly sends no errorKind', async () => {
    ld.variationDetail.mockResolvedValue({ value: false, reason: { kind: 'ERROR' } });

    await new P1FeatureFlagService(configured()).isEnabled(FLAG, SITE_ID);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ flag_reason: 'ERROR' }),
    );
  });

  it('reports each unsynced flag once, rather than only the first one seen', async () => {
    ld.variationDetail.mockResolvedValue({
      value: false,
      reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' },
    });

    const flags = new P1FeatureFlagService(configured());
    await flags.isEnabled(FLAG, SITE_ID);
    await flags.isEnabled(OTHER_FLAG, SITE_ID);
    await flags.isEnabled(FLAG, SITE_ID);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls.map(([, fields]) => (fields as { flag_key: string }).flag_key))
      .toEqual(['p1-test-flag', 'p1-test-other-flag']);
  });

  it('does not attribute an unevaluable flag to LaunchDarkly', async () => {
    ld.variationDetail.mockResolvedValue({
      value: false,
      reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' },
    });

    const flags = new P1FeatureFlagService(configured());
    await flags.isEnabled(FLAG, SITE_ID);

    // `variationDetail` hands back the fallback we passed in, so the resolved value is a
    // boolean and reads as a real evaluation unless the ERROR reason is checked first. The
    // warn above it already says `fallback`; two lines disagreeing on where one resolution
    // came from is worse than either alone.
    const resolvedFields = logger.debug.mock.calls
      .map(([, fields]) => (typeof fields === 'function' ? fields() : fields))
      .filter((fields): fields is { flag_source: string } => fields !== undefined);

    expect(resolvedFields).not.toHaveLength(0);
    for (const fields of resolvedFields) {
      expect(fields.flag_source).toBe('fallback');
    }
  });

  it('keeps serving the flag once LaunchDarkly can evaluate it again', async () => {
    ld.variationDetail
      .mockResolvedValueOnce({ value: false, reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' } })
      .mockResolvedValue({ value: true, reason: { kind: 'FALLTHROUGH' } });

    const flags = new P1FeatureFlagService(configured());
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(true);

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
