import { type LDClient, type LDOptions, init } from '@launchdarkly/cloudflare-server-sdk';
import { getLogger } from '@pantheon-systems/p1-telemetry';

import { type ParsedOverrides, parseFeatureFlagOverrides } from './overrides.js';
import type { P1FeatureFlag } from './p1-feature-flags.js';
import type {
  CloudflareExecutionContext,
  EvaluationReason,
  FeatureFlagEnv,
  FlagSource,
  FlagStore,
} from './types.js';

/**
 * Seconds to wait for the first KV payload. The SDK warns that waiting without a timeout
 * "could result in a long delay when conditions prevent successful initialization", and this
 * sits on a request path — so bound it and fall back to the flag's own default.
 *
 * Passed as `timeout`, not the `timeoutSeconds` the SDK's doc examples show: that name is not
 * on `LDWaitForInitializationOptions` and would be dropped as an excess property, leaving the
 * wait unbounded.
 */
const INIT_TIMEOUT_SECONDS = 2;

/**
 * In-memory flag cache. Without it every evaluation re-reads the KV payload — the edge
 * feature store serves from its cache when present and hits the provider otherwise — putting
 * a KV round trip on every gated request. The TTL is also the ceiling on how long a dashboard
 * toggle takes to reach a warm isolate.
 */
const CACHE_OPTIONS: LDOptions['cache'] = { ttl: 30, checkInterval: 30 };

/**
 * How long a failed initialization keeps this instance on the fallback values.
 *
 * Re-awaiting the timeout per request would add it to every gated request, and never retrying
 * leaves a long-lived isolate stuck on fallbacks for as long as it survives.
 */
const DEGRADED_WINDOW_MS = 5 * 60_000;

/**
 * Routes the SDK's own output through `P1Logger`.
 *
 * Without this the SDK falls back to `BasicLogger` writing to `console`, which skips
 * redaction and the request metadata every other line in the worker carries — and the edge
 * store logs there once per evaluation while a lane is unsynced.
 */
function sdkLogger(): LDOptions['logger'] {
  return {
    error: (...args: unknown[]) => getLogger().error(args.map(String).join(' ')),
    warn: (...args: unknown[]) => getLogger().warn(args.map(String).join(' ')),
    info: (...args: unknown[]) => getLogger().info(args.map(String).join(' ')),
    debug: (...args: unknown[]) => getLogger().debug(args.map(String).join(' ')),
  };
}

/**
 * Flag resolution for one set of bindings.
 *
 * One instance owns one LaunchDarkly client, which the SDK asks to live for the lifetime of
 * the worker: "applications should instantiate a single instance for the lifetime of the
 * worker". Workers hand out bindings at request entry rather than at module scope, so that
 * lifetime is reached through `init` — construct one directly only in tests and anywhere
 * holding its own bindings, such as a Durable Object.
 */
export class P1FeatureFlagService {
  private static instance: P1FeatureFlagService | undefined;
  private static reportedUninitialized = false;

  /**
   * Builds the isolate's service. Call it at request entry, next to `ensureLogger(env)`, and
   * pass `ctx` so initialization runs off the first gated request's critical path.
   *
   * Idempotent per isolate: the same bindings keep the same client, since rebuilding one would
   * throw away the synced payload it has already read.
   */
  static init(env: FeatureFlagEnv, ctx?: CloudflareExecutionContext): P1FeatureFlagService {
    if (this.instance === undefined || !this.instance.matches(env)) {
      this.instance?.close();
      this.instance = new P1FeatureFlagService(env);
    }
    if (ctx !== undefined) {
      this.instance.prewarm(ctx);
    }
    return this.instance;
  }

  /**
   * The isolate's service, for gates that have no bindings in hand.
   *
   * Falls back to an unconfigured instance rather than throwing — a missing `init` should serve
   * the fallbacks, not break the request that was trying to read a gate — and says so once,
   * because otherwise a worker that never initialized looks exactly like one whose flags are
   * all off.
   */
  static current(): P1FeatureFlagService {
    if (this.instance !== undefined) {
      return this.instance;
    }
    if (!this.reportedUninitialized) {
      this.reportedUninitialized = true;
      getLogger().error(
        'feature flags read before P1FeatureFlagService.init; every flag resolves to its fallback',
        undefined,
        { flag_source: 'fallback' },
      );
    }
    this.instance = new P1FeatureFlagService({});
    return this.instance;
  }

  /** Test seam: drops the isolate singleton so a test can initialize a different one. */
  static resetForTests(): void {
    this.instance?.close();
    this.instance = undefined;
    this.reportedUninitialized = false;
  }

  private client: LDClient | undefined;
  private readyPromise: Promise<unknown> | undefined;
  private degradedUntil = 0;
  private reportedUnconfigured = false;
  private readonly reportedEvaluationErrors = new Set<string>();
  private readonly overrides: ParsedOverrides;

  constructor(private readonly env: FeatureFlagEnv) {
    this.overrides = parseFeatureFlagOverrides(env.FLAG_OVERRIDES);
    if (this.overrides.malformed) {
      getLogger().error('FLAG_OVERRIDES is not valid JSON; ignoring it');
    }
  }

  /**
   * Whether a flag is on for the given context key, which is read as the flag's own
   * `contextKind` — a site id for a `site`-kind flag, and so on.
   *
   * Resolution order is `FLAG_OVERRIDES`, then LaunchDarkly, then the flag's own fallback.
   * Every failure resolves to the fallback, so an unreachable or unsynced LaunchDarkly cannot
   * turn a gate on by accident.
   */
  async isEnabled(flag: P1FeatureFlag, contextKey: string): Promise<boolean> {
    const override = this.overrides.values[flag.key];
    if (override !== undefined) {
      return this.resolved(flag, override, 'override');
    }

    const ld = await this.readyClient();
    if (ld === undefined) {
      return this.resolved(flag, flag.fallback, 'fallback');
    }

    const context = { kind: flag.contextKind, key: contextKey };
    try {
      const detail = await ld.variationDetail(flag.key, context, flag.fallback);
      const reason = detail.reason as EvaluationReason | undefined;
      this.reportEvaluationReason(flag, reason);

      // An ERROR reason means LaunchDarkly answered but could not evaluate. `detail.value` is
      // the fallback passed in, so it is a boolean, and without this branch the value would be
      // logged as if LaunchDarkly had chosen it — contradicting the warn line above it.
      //
      // Deliberately does not enter the degraded window. ERROR is per flag key: a flag missing
      // from an otherwise healthy payload reads the same as a payload that never synced, and
      // latching the instance on the first one would suppress reporting for every other flag
      // and block recovery for the whole window.
      if (reason?.kind === 'ERROR') {
        return this.resolved(flag, flag.fallback, 'fallback');
      }

      // Typed as `unknown` rather than the SDK's `any`: a flag whose type was changed in the
      // dashboard should read as its fallback, not as a truthy string.
      const value: unknown = detail.value;
      return typeof value === 'boolean'
        ? this.resolved(flag, value, 'launchdarkly')
        : this.resolved(flag, flag.fallback, 'fallback');
    } catch (error) {
      getLogger().error('LaunchDarkly flag evaluation failed; using its fallback', error, {
        flag_key: flag.key,
        flag_source: 'fallback',
      });
      return flag.fallback;
    }
  }

  /**
   * Starts initialization off the critical path.
   *
   * Without this the first gated request in a cold isolate pays the initialization wait.
   */
  prewarm(ctx: CloudflareExecutionContext): void {
    if (this.getKVBindings() === undefined) {
      return;
    }
    ctx.waitUntil(this.readyClient());
  }

  /** Releases the LaunchDarkly client, and with it its cache purge timer. */
  close(): void {
    this.client?.close();
    this.client = undefined;
    this.readyPromise = undefined;
  }

  /** True when this instance was built from the same bindings, so its client can be reused. */
  matches(env: FeatureFlagEnv): boolean {
    return (
      this.env.LD_KV === env.LD_KV &&
      this.env.LD_CLIENT_SIDE_ID === env.LD_CLIENT_SIDE_ID &&
      this.env.FLAG_OVERRIDES === env.FLAG_OVERRIDES &&
      this.env.ENVIRONMENT === env.ENVIRONMENT
    );
  }

  private getKVBindings(): { store: FlagStore; clientSideId: string; } | undefined {
    const store = this.env.LD_KV;
    const clientSideId = this.env.LD_CLIENT_SIDE_ID;
    if (store === undefined || clientSideId === undefined || clientSideId === '') {
      return undefined;
    }
    return { store, clientSideId };
  }

  /**
   * The initialized client, or `undefined` if LaunchDarkly is unconfigured or unreachable.
   *
   * A failed client is discarded rather than retried: the SDK memoizes its own initialization
   * promise, so a rejected one stays rejected and only a fresh client can recover. Closing it
   * first stops the flag cache's purge timer.
   *
   * The edge SDK defaults to `useLdd`, so it builds no update processor and resolves
   * initialization from a `setTimeout` without reading KV — a missing payload surfaces on the
   * first evaluation, not here. This path is defence for a rejection that configuration does
   * not currently produce, which is why a missing payload is handled at the evaluation instead.
   */
  private async readyClient(): Promise<LDClient | undefined> {
    const bindings = this.getKVBindings();
    if (bindings === undefined) {
      this.reportUnconfigured();
      return undefined;
    }
    if (Date.now() < this.degradedUntil) {
      return undefined;
    }

    // `FlagStore` exists so callers aren't pinned to the SDK's `@cloudflare/workers-types`
    // version; the binding it describes is a real namespace. Taking the parameter type off
    // `init` keeps the cast honest without importing that package here.
    this.client ??= init(
      bindings.clientSideId,
      bindings.store as unknown as Parameters<typeof init>[1],
      { cache: CACHE_OPTIONS, logger: sdkLogger() }
    );
    this.readyPromise ??= this.client.waitForInitialization({ timeout: INIT_TIMEOUT_SECONDS });

    try {
      await this.readyPromise;
      return this.client;
    } catch (error) {
      const failed = this.client;
      this.client = undefined;
      this.readyPromise = undefined;
      this.degradedUntil = Date.now() + DEGRADED_WINDOW_MS;
      failed?.close();
      getLogger().error(
        'LaunchDarkly initialization failed; flags resolve to their fallbacks',
        error,
        { flag_source: 'fallback' }
      );
      return undefined;
    }
  }

  /**
   * An unconfigured lane is normal locally and in tests, and a fault anywhere else — the
   * deployed lanes carry no per-flag vars to fall back to, so a mistyped binding would
   * otherwise read as "every flag is off" with nothing anywhere to say so.
   */
  private reportUnconfigured(): void {
    const lane = this.env.ENVIRONMENT;
    if (this.reportedUnconfigured || lane === 'local' || lane === undefined) {
      return;
    }
    this.reportedUnconfigured = true;
    getLogger().error(
      'LaunchDarkly is not configured in a deployed lane; flags resolve to their fallbacks',
      undefined,
      { flag_source: 'fallback' }
    );
  }

  /**
   * A reason of `ERROR` means LaunchDarkly answered but could not evaluate — most often
   * `FLAG_NOT_FOUND`, which is what a flag missing from the synced payload looks like. The
   * edge SDK sends no analytics events, so this log line is the only place that distinguishes
   * "the flag is off" from "the flag never arrived".
   */
  private reportEvaluationReason(flag: P1FeatureFlag, reason: EvaluationReason | undefined): void {
    if (reason?.kind !== 'ERROR' || this.reportedEvaluationErrors.has(flag.key)) {
      return;
    }
    this.reportedEvaluationErrors.add(flag.key);
    getLogger().warn('LaunchDarkly could not evaluate a flag; using its fallback', {
      flag_key: flag.key,
      flag_reason: reason.errorKind ?? reason.kind,
      flag_source: 'fallback',
    });
  }

  /** Logged rather than returned: the source is what tells a reader why a gate did what it did. */
  private resolved(flag: P1FeatureFlag, value: boolean, source: FlagSource): boolean {
    getLogger().debug('feature flag resolved', () => ({
      flag_key: flag.key,
      flag_value: value,
      flag_source: source,
    }));
    return value;
  }
}
