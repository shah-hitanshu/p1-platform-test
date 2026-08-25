/** Generation settings that belong to the model rather than to the caller. */
export interface ModelSettings {
  maxOutputTokens: number;
  temperature: number;
}

/**
 * Most of what the agent emits is exact — prop keys, paths, ids — and provider defaults sample
 * hotter than 0.2.
 */
export const DEFAULT_MODEL_SETTINGS: Readonly<ModelSettings> = {
  maxOutputTokens: 8192,
  temperature: 0.2,
};

/**
 * Keyed by the full `AGENT_MODEL` value, and empty while every environment runs the same model.
 * The seam exists so a model whose cap or sampling differs is one entry here, rather than a
 * constant in the turn loop that silently applies to whatever is configured.
 */
const MODEL_OVERRIDES: Record<string, Partial<ModelSettings>> = {};

/** Settings for `model`, falling back to {@link DEFAULT_MODEL_SETTINGS} field by field. */
export function modelSettings(
  model: string,
  overrides: Record<string, Partial<ModelSettings>> = MODEL_OVERRIDES,
): ModelSettings {
  return { ...DEFAULT_MODEL_SETTINGS, ...overrides[model] };
}
