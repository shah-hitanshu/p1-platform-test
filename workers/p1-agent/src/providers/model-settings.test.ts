import { describe, it, expect } from 'vitest';
import { DEFAULT_MODEL_SETTINGS, modelSettings, type ModelSettings } from './model-settings.js';

describe('modelSettings', () => {
  it('leaves the deployed model on the defaults', () => {
    expect(modelSettings('@cf/moonshotai/kimi-k2.7-code')).toEqual(DEFAULT_MODEL_SETTINGS);
  });

  it('lets a model override one field without inheriting the other from another model', () => {
    const overrides: Record<string, Partial<ModelSettings>> = {
      'anthropic/claude-sonnet-4-5': { maxOutputTokens: 64000 },
    };

    expect(modelSettings('anthropic/claude-sonnet-4-5', overrides)).toEqual({
      maxOutputTokens: 64000,
      temperature: DEFAULT_MODEL_SETTINGS.temperature,
    });
    expect(modelSettings('openai/gpt-4o', overrides)).toEqual(DEFAULT_MODEL_SETTINGS);
  });

  it('does not mutate the defaults it merges onto', () => {
    modelSettings('m', { m: { temperature: 1 } });

    expect(DEFAULT_MODEL_SETTINGS.temperature).toBe(0.2);
  });
});
