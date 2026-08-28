import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import type { ComponentConfig } from '@puckeditor/core';

/**
 * Blocks not yet through the phase-2 conversion. Remove a name when its
 * conversion task lands; never add one back.
 */
const PENDING = new Set<string>([
]);

const PLAIN_PROSE_TYPES = new Set(['text', 'textarea']);

const blocksDir = import.meta.dirname;

let allBlocks: [string, ComponentConfig][] = [];
let converted: [string, ComponentConfig][] = [];

beforeAll(async () => {
  const blockDirs = readdirSync(blocksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const modules = await Promise.all(
    blockDirs.map(async (name) => {
      const mod = await import(join(blocksDir, name, `${name}.block`));
      return Object.entries(mod).find(
        ([k, v]) => k.endsWith('Block') && typeof (v as ComponentConfig)?.render === 'function',
      ) as [string, ComponentConfig] | undefined;
    }),
  );

  allBlocks = modules.filter((e): e is [string, ComponentConfig] => e !== undefined);
  converted = allBlocks.filter(([name]) => !PENDING.has(name));
});

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

  it('uses the puck-css richtext helper rather than a bare textarea for long prose', () => {
    // richtextField/inlineTextField produce a custom field with a render fn.
    // A bare `textarea` for body copy means the block was converted without the
    // field migration and will feel inert next to the starter kit's blocks.
    // Note: arrayFields inside type:"array" fields are not checked here.
    // footer `links` and pricing `features` use textarea for line-delimited data (not prose).
    // If a prose-body arrayField appears, extend this check to recurse into arrayFields.
    for (const [name, block] of converted) {
      for (const [fieldName, field] of Object.entries(block.fields ?? {})) {
        const typed = field as { type?: string };
        expect(
          typed.type === 'textarea',
          `${name}.fields.${fieldName} is a bare textarea — use richtextField or inlineTextField`,
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
