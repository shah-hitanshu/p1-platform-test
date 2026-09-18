import type { FlagContextKind } from './types.js';

/**
 * Every LaunchDarkly flag key this platform reads, in either runtime.
 *
 * The one part of a flag that is shared vocabulary: the key has to match the dashboard, and
 * two consumers gating the same flag have to spell it identically. Fallback and context kind
 * are not shared — the same flag can ramp per site in a worker and per user in the browser.
 *
 * A list rather than a bare union so the vocabulary can be enumerated at runtime: a key
 * that matches nothing in LaunchDarkly resolves to off, which is indistinguishable from not
 * yet rolled out, so `pnpm check:flag-keys` compares this against the browser catalog that
 * cannot import it.
 *
 * Wider than `P1_FEATURE_FLAG_CONFIGURATIONS`: it also carries the keys gated elsewhere,
 * which have no configuration here.
 */
export const P1_FLAG_KEYS = [
  'p1-merge-job-runner',
  /** Gated in `apps/p1-starter` through the browser SDK, not by this service. */
  'p1-chatbot',
  /** Gated in the browser through `useP1ExperimentalFeatures`, not by this service. */
  'p1-collaboration',
] as const;

export type P1FlagKey = (typeof P1_FLAG_KEYS)[number];

/**
 * A boolean flag: its dashboard key, the value to resolve to when LaunchDarkly cannot answer,
 * and what its evaluation context is keyed on.
 *
 * All three are static properties of the flag, so they travel together. The fallback in
 * particular lives here rather than at the call site so that every failure path — unconfigured
 * lane, unreachable store, malformed value — agrees on what "we don't know" means for this
 * particular gate.
 */
export interface P1FeatureFlag {
  readonly key: P1FlagKey;
  readonly fallback: boolean;
  readonly contextKind: FlagContextKind;
}

/**
 * Every flag this service resolves.
 *
 * `satisfies` rather than an annotation so each entry keeps its literal types while still being
 * checked; one object rather than loose consts so the catalog can be enumerated. Only the flags
 * this service resolves appear here — `P1_FLAG_KEYS` is the wider vocabulary.
 */
export const P1_FEATURE_FLAG_CONFIGURATIONS = {
  /**
   * Gates merge execution in `workers/ccr`: the job runner when on, the legacy inline path
   * when off. Falls back to off, so an unreachable or unsynced LaunchDarkly keeps serving the
   * path we ship today.
   *
   * Keyed on the site even though the flag is a global on/off today: the site id is already in
   * hand at the gate, and this leaves a per-site ramp as a LaunchDarkly-side change rather than
   * a code change.
   */
  mergeJobRunner: {
    key: 'p1-merge-job-runner',
    fallback: false,
    contextKind: 'site',
  },
} as const satisfies Record<string, P1FeatureFlag>;
