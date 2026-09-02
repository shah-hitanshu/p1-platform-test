/**
 * @pantheon-systems/p1-feature-flags
 *
 * Internal, unpublished. Boolean flag resolution for the workers, over LaunchDarkly's
 * Cloudflare SDK — which evaluates out of a KV namespace the LD -> Cloudflare integration
 * keeps in sync, so an evaluation is an in-memory read rather than an outbound call.
 *
 * `P1FeatureFlagService.init(env, ctx)` at request entry builds the isolate's service;
 * `isEnabled` takes a flag and the key to evaluate it against, and the flag itself carries its
 * fallback and its context kind.
 *
 * Every flag this platform reads is declared in `p1-feature-flags.ts`, so one file answers
 * what exists, what it falls back to, and what it ramps on. See the README for the naming and
 * retirement conventions.
 */

export { P1FeatureFlagService } from './P1FeatureFlagService.js';

export {
  P1_FEATURE_FLAG_CONFIGURATIONS,
  type P1FeatureFlag,
  type P1FlagKey,
} from './p1-feature-flags.js';

export {
  type CloudflareExecutionContext,
  type FeatureFlagEnv,
  type FlagContextKind,
  type FlagStore,
} from './types.js';
