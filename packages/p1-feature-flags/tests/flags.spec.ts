/**
 * Flag resolution.
 *
 * A gate is only as good as its behaviour when LaunchDarkly does not answer, so most of what
 * is asserted here is the failure surface: every such case resolves to the flag's fallback,
 * none of them adds the initialization wait to more than one request per isolate, and none of
 * them is silent.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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

/**
 * Resolution is asserted against keys that are deliberately not in `P1FlagKey`: what is
 * covered here is the machinery, and pinning it to a live flag would break these tests the day
 * that flag retires. The real catalog is covered in `flag-catalog.spec.ts`.
 */
function testFlag(key: string, fallback: boolean, contextKind: FlagContextKind): P1FeatureFlag {
  return { key: key as P1FlagKey, fallback, contextKind };
}

const FLAG = testFlag('p1-test-flag', false, 'site');
const SITE_ID = 'site-123';

/** A stand-in for the bound namespace; the SDK is mocked, so it is never read. */
const KV = {} as FlagStore;

function configured(overrides: Partial<FeatureFlagEnv> = {}): FeatureFlagEnv {
  return { LD_KV: KV, LD_CLIENT_SIDE_ID: 'client-side-id', ENVIRONMENT: 'staging', ...overrides };
}

function flagsFor(env: FeatureFlagEnv): P1FeatureFlagService {
  return new P1FeatureFlagService(env);
}

function enabled(env: FeatureFlagEnv): Promise<boolean> {
  return flagsFor(env).isEnabled(FLAG, SITE_ID);
}

beforeEach(() => {
  P1FeatureFlagService.resetForTests();
  vi.clearAllMocks();
  ld.waitForInitialization.mockResolvedValue(undefined);
  ld.variationDetail.mockResolvedValue({ value: false, reason: { kind: 'OFF' } });
});

describe('FLAG_OVERRIDES', () => {
  it('answers ahead of LaunchDarkly, which is how local dev and tests run', async () => {
    await expect(enabled({ FLAG_OVERRIDES: '{"p1-test-flag":true}' })).resolves.toBe(true);
    expect(ld.init).not.toHaveBeenCalled();
  });

  it('wins over a configured LaunchDarkly, so a bad flag value can be overridden', async () => {
    ld.variationDetail.mockResolvedValue({ value: true, reason: { kind: 'FALLTHROUGH' } });
    await expect(enabled(configured({ FLAG_OVERRIDES: '{"p1-test-flag":false}' }))).resolves.toBe(
      false,
    );
    expect(ld.variationDetail).not.toHaveBeenCalled();
  });

  it('ignores a non-boolean member rather than guessing at it', async () => {
    await expect(enabled({ FLAG_OVERRIDES: '{"p1-test-flag":"true"}' })).resolves.toBe(false);
  });

  it('ignores overrides for other flags', async () => {
    await expect(enabled({ FLAG_OVERRIDES: '{"p1-other-flag":true}' })).resolves.toBe(false);
  });

  it('falls through and reports once when the JSON is malformed', async () => {
    const flags = flagsFor({ FLAG_OVERRIDES: '{not json' });
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('without LaunchDarkly configured', () => {
  it('resolves to the fallback', async () => {
    await expect(enabled({ ENVIRONMENT: 'local' })).resolves.toBe(false);
    expect(ld.init).not.toHaveBeenCalled();
  });

  it('resolves to a true fallback too, so a kill switch defaults to on', async () => {
    const killSwitch = testFlag('p1-test-kill-switch', true, 'site');
    await expect(flagsFor({ ENVIRONMENT: 'local' }).isEnabled(killSwitch, SITE_ID)).resolves.toBe(
      true,
    );
  });

  it('treats an empty client-side ID as unconfigured', async () => {
    await expect(enabled({ LD_KV: KV, LD_CLIENT_SIDE_ID: '', ENVIRONMENT: 'local' })).resolves.toBe(
      false,
    );
    expect(ld.init).not.toHaveBeenCalled();
  });

  it('reports once in a deployed lane, where an absent binding is a fault', async () => {
    const flags = flagsFor({ ENVIRONMENT: 'production' });
    await flags.isEnabled(FLAG, SITE_ID);
    await flags.isEnabled(FLAG, SITE_ID);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('says nothing locally, where an absent binding is normal', async () => {
    await enabled({ ENVIRONMENT: 'local' });
    await enabled({});
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('with LaunchDarkly configured', () => {
  it('returns the flag value and passes the fallback as the evaluation default', async () => {
    ld.variationDetail.mockResolvedValue({ value: true, reason: { kind: 'FALLTHROUGH' } });
    await expect(enabled(configured())).resolves.toBe(true);
    expect(ld.variationDetail).toHaveBeenCalledWith('p1-test-flag', expect.anything(), false);
  });

  it("evaluates against the flag's own context kind, keyed on what the caller passed", async () => {
    const organizationFlag = testFlag('p1-test-org-flag', false, 'organization');

    const flags = flagsFor(configured());
    await flags.isEnabled(FLAG, SITE_ID);
    await flags.isEnabled(organizationFlag, 'org-9');

    expect(ld.variationDetail).toHaveBeenNthCalledWith(
      1,
      'p1-test-flag',
      { kind: 'site', key: SITE_ID },
      false,
    );
    expect(ld.variationDetail).toHaveBeenNthCalledWith(
      2,
      'p1-test-org-flag',
      { kind: 'organization', key: 'org-9' },
      false,
    );
  });

  it('treats a non-boolean flag value as the fallback rather than as truthy', async () => {
    ld.variationDetail.mockResolvedValue({ value: 'true', reason: { kind: 'FALLTHROUGH' } });
    await expect(enabled(configured())).resolves.toBe(false);
  });

  it('builds one client and waits once, however many requests arrive', async () => {
    const flags = flagsFor(configured());
    await flags.isEnabled(FLAG, SITE_ID);
    await flags.isEnabled(FLAG, SITE_ID);
    await flags.isEnabled(FLAG, 'site-456');

    expect(ld.init).toHaveBeenCalledTimes(1);
    expect(ld.waitForInitialization).toHaveBeenCalledTimes(1);
    expect(ld.variationDetail).toHaveBeenCalledTimes(3);
  });

  it('waits once even when the first requests arrive concurrently', async () => {
    const flags = flagsFor(configured());
    await Promise.all([
      flags.isEnabled(FLAG, SITE_ID),
      flags.isEnabled(FLAG, SITE_ID),
      flags.isEnabled(FLAG, SITE_ID),
    ]);
    expect(ld.waitForInitialization).toHaveBeenCalledTimes(1);
  });

  it('passes a bounded timeout, so a stalled init cannot hang a request', async () => {
    await enabled(configured());
    // `timeout`, not the `timeoutSeconds` LD's doc examples show: that name is not on the
    // options type and would be silently dropped, leaving the wait unbounded.
    const [options] = ld.waitForInitialization.mock.calls[0] as [{ timeout: number }];
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(5);
  });

  it('enables the in-memory cache, so evaluation does not re-read KV every call', async () => {
    await enabled(configured());
    const [, , options] = ld.init.mock.calls[0] as [string, unknown, { cache?: unknown }];
    expect(options.cache).toBeDefined();
  });

  it('reports an ERROR reason once, which is what an unsynced flag looks like', async () => {
    ld.variationDetail.mockResolvedValue({
      value: false,
      reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' },
    });

    const flags = flagsFor(configured());
    await flags.isEnabled(FLAG, SITE_ID);
    await flags.isEnabled(FLAG, SITE_ID);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ flag_key: 'p1-test-flag', flag_reason: 'FLAG_NOT_FOUND' }),
    );
  });

  it('says nothing extra when the flag simply evaluated to off', async () => {
    await enabled(configured());
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('when LaunchDarkly is unreachable', () => {
  it('resolves to the fallback when initialization fails', async () => {
    ld.waitForInitialization.mockRejectedValue(new Error('kv unavailable'));
    await expect(enabled(configured())).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('does not re-await a failed initialization on later requests', async () => {
    ld.waitForInitialization.mockRejectedValue(new Error('kv unavailable'));

    const flags = flagsFor(configured());
    await flags.isEnabled(FLAG, SITE_ID);
    await flags.isEnabled(FLAG, SITE_ID);
    await flags.isEnabled(FLAG, SITE_ID);

    expect(ld.waitForInitialization).toHaveBeenCalledTimes(1);
    expect(ld.variationDetail).not.toHaveBeenCalled();
  });

  it('closes the failed client, so its cache timer does not outlive it', async () => {
    ld.waitForInitialization.mockRejectedValue(new Error('kv unavailable'));
    await enabled(configured());
    expect(ld.close).toHaveBeenCalledTimes(1);
  });

  it('resolves to the fallback when evaluation itself throws', async () => {
    ld.variationDetail.mockRejectedValue(new Error('store closed'));
    await expect(enabled(configured())).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('keeps serving later requests after a single failed evaluation', async () => {
    ld.variationDetail
      .mockRejectedValueOnce(new Error('store closed'))
      .mockResolvedValue({ value: true, reason: { kind: 'FALLTHROUGH' } });

    const flags = flagsFor(configured());
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(true);
  });
});

describe('recovery after a failed initialization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a fresh client once the degraded window has passed', async () => {
    ld.waitForInitialization.mockRejectedValueOnce(new Error('kv unavailable'));
    const flags = flagsFor(configured());
    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(false);

    ld.variationDetail.mockResolvedValue({ value: true, reason: { kind: 'FALLTHROUGH' } });
    vi.advanceTimersByTime(10 * 60_000);

    await expect(flags.isEnabled(FLAG, SITE_ID)).resolves.toBe(true);
    // A rejected client can never recover — the SDK memoizes its own initialization promise.
    expect(ld.init).toHaveBeenCalledTimes(2);
  });
});

describe('P1FeatureFlagService.init', () => {
  it('starts initialization off the caller path', () => {
    const waitUntil = vi.fn();
    P1FeatureFlagService.init(configured(), { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(ld.init).toHaveBeenCalledTimes(1);
  });

  it('does nothing to prewarm when LaunchDarkly is not configured', () => {
    const waitUntil = vi.fn();
    P1FeatureFlagService.init({ ENVIRONMENT: 'local' }, { waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(ld.init).not.toHaveBeenCalled();
  });

  it('leaves the isolate warm, so the first gated request does not wait again', async () => {
    const waitUntil = vi.fn();
    const flags = P1FeatureFlagService.init(configured(), { waitUntil });
    await flags.isEnabled(FLAG, SITE_ID);
    expect(ld.init).toHaveBeenCalledTimes(1);
    expect(ld.waitForInitialization).toHaveBeenCalledTimes(1);
  });

  it('keeps the same client across requests carrying the same bindings', async () => {
    const first = P1FeatureFlagService.init(configured());
    const second = P1FeatureFlagService.init(configured());

    expect(second).toBe(first);
    await second.isEnabled(FLAG, SITE_ID);
    expect(ld.init).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when the bindings change, so a stale client cannot outlive its config', () => {
    P1FeatureFlagService.init(configured());
    const rebuilt = P1FeatureFlagService.init(configured({ LD_CLIENT_SIDE_ID: 'other-id' }));

    expect(rebuilt.matches(configured())).toBe(false);
    expect(P1FeatureFlagService.current()).toBe(rebuilt);
  });
});

describe('P1FeatureFlagService.current', () => {
  it('returns the initialized service', () => {
    const flags = P1FeatureFlagService.init(configured());
    expect(P1FeatureFlagService.current()).toBe(flags);
  });

  it('falls back to an unconfigured service, and says so once', async () => {
    await expect(P1FeatureFlagService.current().isEnabled(FLAG, SITE_ID)).resolves.toBe(false);
    await expect(P1FeatureFlagService.current().isEnabled(FLAG, SITE_ID)).resolves.toBe(false);

    expect(ld.init).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
