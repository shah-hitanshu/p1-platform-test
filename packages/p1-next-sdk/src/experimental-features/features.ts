/**
 * The experimental features a P1 editor can have turned on for it, and the LaunchDarkly
 * flag key each one is gated by.
 *
 * Applications name the feature, never the flag key: the key has to match the
 * LaunchDarkly dashboard, and which key backs a feature is Pantheon's to change.
 */
export const P1_EXPERIMENTAL_FEATURE_FLAGS = {
  /** Comment threads on blocks, pages and other addressable content. */
  threads: "p1-collaboration",
} as const;

export type P1ExperimentalFeature = keyof typeof P1_EXPERIMENTAL_FEATURE_FLAGS;

export const P1_EXPERIMENTAL_FEATURES = Object.keys(
  P1_EXPERIMENTAL_FEATURE_FLAGS,
) as P1ExperimentalFeature[];

/** Every experimental feature off. What an unanswered LaunchDarkly resolves to. */
export type P1ExperimentalFeatureSet = Record<P1ExperimentalFeature, boolean>;

export const ALL_OFF: P1ExperimentalFeatureSet = Object.freeze(
  Object.fromEntries(
    P1_EXPERIMENTAL_FEATURES.map((feature) => [feature, false]),
  ),
) as P1ExperimentalFeatureSet;

/**
 * Read the features out of a raw LaunchDarkly flag set.
 *
 * Anything that is not literally `true` is off, so a missing flag, a null from an
 * unsynced environment, and a non-boolean value all land on the safe side rather than
 * exposing an unfinished feature.
 */
export function readFeatures(
  flags: Record<string, unknown>,
): P1ExperimentalFeatureSet {
  return Object.fromEntries(
    P1_EXPERIMENTAL_FEATURES.map((feature) => [
      feature,
      flags[P1_EXPERIMENTAL_FEATURE_FLAGS[feature]] === true,
    ]),
  ) as P1ExperimentalFeatureSet;
}
