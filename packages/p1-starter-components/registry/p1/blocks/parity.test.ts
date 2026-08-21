import { describe, it, expect } from 'vitest';
import type { ComponentConfig } from '@puckeditor/core';
import * as lib from './index';

/**
 * Blocks not yet through the phase-2 conversion. Remove a name when its
 * conversion task lands; never add one back.
 */
const PENDING = new Set<string>([
  'HeaderBlock', 'FooterBlock',
  'HeroBlock', 'AnnouncementBlock',
  'LogoCloudBlock', 'TestimonialBlock', 'StatsBlock', 'TeamGridBlock',
  'FeatureCardsBlock', 'FeatureMediaBlock', 'StepsBlock', 'TimelineBlock',
  'PricingBlock', 'FaqBlock', 'LeadCaptureBlock', 'CtaBannerBlock', 'ComparisonTableBlock',
]);

const PLAIN_PROSE_TYPES = new Set(['text', 'textarea']);

const allBlocks = Object.entries(lib).filter(
  ([name, value]) =>
    name.endsWith('Block') && typeof (value as ComponentConfig)?.render === 'function',
) as [string, ComponentConfig][];

const converted = allBlocks.filter(([name]) => !PENDING.has(name));

describe('create-block convention parity', () => {
  it('has at least one converted block to check', () => {
    expect(converted.length).toBeGreaterThan(0);
  });

  it('gives every field a defaultProps entry', () => {
    for (const [name, block] of converted) {
      const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
      for (const field of Object.keys(block.fields ?? {})) {
        expect(
          Object.hasOwn(defaults, field),
          `${name}.fields.${field} has no defaultProps entry — it renders empty on insert`,
        ).toBe(true);
      }
    }
  });

  it('gives every prose field ai.instructions', () => {
    for (const [name, block] of converted) {
      for (const [fieldName, field] of Object.entries(block.fields ?? {})) {
        const typed = field as {
          type?: string;
          ai?: { instructions?: string; exclude?: boolean };
        };
        if (!typed.type || !PLAIN_PROSE_TYPES.has(typed.type)) continue;
        if (typed.ai?.exclude === true) continue;
        expect(
          typeof typed.ai?.instructions === 'string' && typed.ai.instructions.length > 0,
          `${name}.fields.${fieldName} is a ${typed.type} field with no ai.instructions`,
        ).toBe(true);
      }
    }
  });

  it('uses the puck-css richtext helper rather than a bare textarea for long prose (D11)', () => {
    // richtextField/inlineTextField produce a custom field with a render fn.
    // A bare `textarea` for body copy means the block was converted without the
    // field migration and will feel inert next to the starter kit's blocks.
    for (const [name, block] of converted) {
      for (const [fieldName, field] of Object.entries(block.fields ?? {})) {
        const typed = field as { type?: string };
        expect(
          typed.type === 'textarea',
          `${name}.fields.${fieldName} is a bare textarea — use richtextField (PCC-3580 D11)`,
        ).toBe(false);
      }
    }
  });

  it('lists only real blocks as pending', () => {
    const names = new Set(allBlocks.map(([name]) => name));
    for (const name of PENDING) {
      expect(names.has(name), `PENDING lists ${name}, which is not a block`).toBe(true);
    }
  });
});
