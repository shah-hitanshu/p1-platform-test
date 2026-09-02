export interface ParsedOverrides {
  readonly values: Record<string, boolean>;
  readonly malformed: boolean;
}

const NONE: ParsedOverrides = { values: {}, malformed: false };

/**
 * Reads the `FLAG_OVERRIDES` var.
 *
 * Non-boolean members are dropped: an override is a definite answer, and a string `"true"`
 * from a hand-edited var is not one. Malformed JSON is reported back rather than thrown, so
 * the caller can log it once instead of once per evaluation.
 */
export function parseFeatureFlagOverrides(raw: string | undefined): ParsedOverrides {
  if (raw === undefined || raw === '') {
    return NONE;
  }

  const values: Record<string, boolean> = {};
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { values, malformed: true };
  }

  if (typeof decoded === 'object' && decoded !== null) {
    for (const [key, value] of Object.entries(decoded)) {
      if (typeof value === 'boolean') {
        values[key] = value;
      }
    }
  }

  return { values, malformed: false };
}
