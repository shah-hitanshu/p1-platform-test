import {
  P1_EXPERIMENTAL_FEATURE_FLAGS,
  P1_EXPERIMENTAL_FEATURES,
  type P1ExperimentalFeature,
} from "./features";

export const FLAG_OVERRIDES_VAR = "NEXT_PUBLIC_P1_FLAG_OVERRIDES";

type Overrides = Partial<Record<P1ExperimentalFeature, boolean>>;

const NONE: Overrides = {};

/**
 * Reads a flag override out of the raw variable.
 *
 * Two spellings, because one is typed by hand and the other is shared with the
 * configuration a worker reads: a comma-separated list of flag keys turns each of them
 * on, and a JSON object of flag key to boolean can also turn one off. Non-boolean
 * members are dropped — an override is a definite answer, and a string `"true"` from a
 * hand-edited variable is not one.
 */
function parse(raw: string): Record<string, boolean> {
  const values: Record<string, boolean> = {};

  if (!raw.trimStart().startsWith("{")) {
    for (const key of raw.split(",")) {
      if (key.trim()) {
        values[key.trim()] = true;
      }
    }
    return values;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return values;
  }

  if (typeof decoded === "object" && decoded !== null) {
    for (const [key, value] of Object.entries(decoded)) {
      if (typeof value === "boolean") {
        values[key] = value;
      }
    }
  }

  return values;
}

/**
 * Flag overrides set for local development, keyed by feature.
 *
 * Always empty in a production build: the check below is replaced at build time, so the
 * override cannot be turned on against a deployed site and the code that reads it is
 * dropped from the bundle. It is a development tool, not a supported toggle.
 *
 * A key that matches no experimental feature is ignored. Nothing here can report that,
 * so `pnpm dev:stack --flags=…` checks the spelling before a dev server starts.
 */
export function localFlagOverrides(): Overrides {
  if (process.env.NODE_ENV === "production") {
    return NONE;
  }

  const raw = process.env[FLAG_OVERRIDES_VAR];
  if (!raw) {
    return NONE;
  }

  const byKey = parse(raw);
  const overrides: Overrides = {};
  for (const feature of P1_EXPERIMENTAL_FEATURES) {
    const value = byKey[P1_EXPERIMENTAL_FEATURE_FLAGS[feature]];
    if (typeof value === "boolean") {
      overrides[feature] = value;
    }
  }

  return overrides;
}

/** Whether an override answers for every feature, so nothing needs resolving remotely. */
export function overridesEveryFeature(overrides: Overrides): boolean {
  return P1_EXPERIMENTAL_FEATURES.every((feature) => feature in overrides);
}
