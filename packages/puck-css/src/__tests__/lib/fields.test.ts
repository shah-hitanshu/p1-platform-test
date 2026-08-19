import { describe, expect, it } from 'vitest';

describe('richtextField', () => {
  it('exports richtextField', async () => {
    const mod = await import('../../data/fields');
    expect(mod.richtextField).toBeDefined();
  });

  it('has type richtext', async () => {
    const { richtextField } = await import('../../data/fields');
    expect(richtextField.type).toBe('richtext');
  });

  it('enables inline canvas editing', async () => {
    const { richtextField } = await import('../../data/fields');
    expect(richtextField.contentEditable).toBe(true);
  });

  it('includes ai instructions', async () => {
    const { richtextField } = await import('../../data/fields');
    expect(richtextField.ai).toBeDefined();
    expect(typeof richtextField.ai?.instructions).toBe('string');
    expect((richtextField.ai?.instructions ?? '').length).toBeGreaterThan(0);
  });

  it('provides a renderMenu function', async () => {
    const { richtextField } = await import('../../data/fields');
    expect(typeof richtextField.renderMenu).toBe('function');
  });

  it('disables the textAlign extension so pasted alignment is unrepresentable', async () => {
    // The toolbar never exposes alignment, so leaving TipTap's textAlign
    // extension registered only lets paste smuggle in `text-align` the schema
    // would otherwise represent. Disabling it makes the schema drop alignment
    // on every ingest path.
    const { richtextField } = await import('../../data/fields');
    expect((richtextField as any).options?.textAlign).toBe(false);
  });
});

describe('createRichtextField', () => {
  it('exports createRichtextField', async () => {
    const mod = await import('../../data/fields');
    expect(mod.createRichtextField).toBeDefined();
  });

  it('returns base richtextField shape when called with no args', async () => {
    const { createRichtextField } = await import('../../data/fields');
    const field = createRichtextField();
    expect(field.type).toBe('richtext');
    expect(field.contentEditable).toBe(true);
    expect(field.ai).toBeDefined();
    expect(typeof field.renderMenu).toBe('function');
  });

  it('merges options overrides while keeping base options and not mutating the base field', async () => {
    const { createRichtextField, richtextField } = await import('../../data/fields');
    const field = createRichtextField({ options: { bold: false } });
    expect((field as any).options?.bold).toBe(false);
    // The base default (textAlign disabled) survives the merge...
    expect((field as any).options?.textAlign).toBe(false);
    // ...and the base field is not mutated by the override.
    expect((richtextField as any).options?.bold).toBeUndefined();
    expect((richtextField as any).options?.textAlign).toBe(false);
  });

  it('lets a block re-enable textAlign via an options override', async () => {
    const { createRichtextField } = await import('../../data/fields');
    const field = createRichtextField({
      options: { textAlign: { types: ['paragraph'] } },
    });
    expect((field as any).options?.textAlign).toEqual({ types: ['paragraph'] });
  });

  it('allows overriding ai instructions', async () => {
    const { createRichtextField } = await import('../../data/fields');
    const customInstructions = 'Use short, punchy sentences.';
    const field = createRichtextField({ ai: { instructions: customInstructions } });
    expect(field.ai?.instructions).toBe(customInstructions);
  });

  it('preserves renderMenu when overriding other props', async () => {
    const { createRichtextField } = await import('../../data/fields');
    const field = createRichtextField({ label: 'Body text' });
    expect(typeof field.renderMenu).toBe('function');
  });

  it('deep-merges ai so overriding one key keeps the default instructions', async () => {
    const { createRichtextField, richtextField } = await import('../../data/fields');
    const field = createRichtextField({ ai: { exclude: true } });
    expect(field.ai?.exclude).toBe(true);
    // The partial `ai` override must not drop the default instructions.
    expect(field.ai?.instructions).toBe(richtextField.ai?.instructions);
  });

  it('does not mutate the base field ai when overriding ai keys', async () => {
    const { createRichtextField, richtextField } = await import('../../data/fields');
    createRichtextField({ ai: { exclude: true } });
    expect(richtextField.ai?.exclude).toBeUndefined();
    expect(typeof richtextField.ai?.instructions).toBe('string');
  });
});

describe('inlineTextField', () => {
  it('exports inlineTextField', async () => {
    const mod = await import('../../data/fields');
    expect(mod.inlineTextField).toBeDefined();
  });

  it('has type text', async () => {
    const { inlineTextField } = await import('../../data/fields');
    expect(inlineTextField.type).toBe('text');
  });

  it('enables inline canvas editing', async () => {
    const { inlineTextField } = await import('../../data/fields');
    expect(inlineTextField.contentEditable).toBe(true);
  });

  it('includes ai instructions', async () => {
    const { inlineTextField } = await import('../../data/fields');
    expect(inlineTextField.ai).toBeDefined();
    expect(typeof inlineTextField.ai?.instructions).toBe('string');
    expect((inlineTextField.ai?.instructions ?? '').length).toBeGreaterThan(0);
  });
});
