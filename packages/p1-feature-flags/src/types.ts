/**
 * The LaunchDarkly context kinds this platform evaluates against.
 *
 * A closed union rather than `string`: the kind has to match what the dashboard targets on,
 * and a typo there is a flag that silently never matches a rule.
 */
export type FlagContextKind = 'site' | 'organization' | 'user';

/**
 * The `waitUntil` half of a Cloudflare `ExecutionContext`.
 *
 * Structural rather than the real `ExecutionContext`, for the same reason as `FlagStore`:
 * that type is an ambient global from `@cloudflare/workers-types`, and the workers here are
 * on three different versions of it. A real context satisfies this.
 */
export interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** The `reason` LaunchDarkly returns alongside an evaluated value. */
export interface EvaluationReason {
  kind?: string;
  errorKind?: string;
}

/** Where a resolved value came from, for logs. */
export type FlagSource = 'override' | 'launchdarkly' | 'fallback';

/**
 * The one KV method the flag store reads.
 *
 * Structural rather than `KVNamespace` so a worker's own binding type satisfies it without
 * the worker and this package having to agree on a `@cloudflare/workers-types` version.
 */
export interface FlagStore {
  get(key: string): Promise<string | null>;
}

/**
 * Only the bindings flag resolution reads. Declared structurally rather than as a worker's
 * `Env` so Durable Object envs and test doubles satisfy it too.
 */
export interface FeatureFlagEnv {
  /** Distinguishes a lane where an absent LaunchDarkly is normal from one where it is a fault. */
  ENVIRONMENT?: string;
  /** Flag payload, kept in sync by the LaunchDarkly -> Cloudflare integration. */
  LD_KV?: FlagStore;
  /** Client-side ID. Public by design and only used to key into `LD_KV`. */
  LD_CLIENT_SIDE_ID?: string;
  /**
   * JSON object of flag key to boolean, consulted ahead of LaunchDarkly. This is how the
   * local lane and the test suites run without an LD connection, and it is the only way to
   * move a deployed lane off a bad flag value when LaunchDarkly itself is unreachable.
   */
  FLAG_OVERRIDES?: string;
}
