import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EXAMPLE_BLOCK, EXAMPLE_REGISTRATION } from '../lib/messages.js';

// The scaffolder prints a worked example rather than fetching one, so nothing
// stops it going stale. These read what the registry actually serves.
const registryDir = join(import.meta.dirname, '../../p1-starter-components/registry/p1');
const blocks = JSON.parse(readFileSync(join(registryDir, 'blocks/registry.json'), 'utf-8')).items;
const base = JSON.parse(readFileSync(join(registryDir, 'base/registry.json'), 'utf-8')).items[0];

describe('the registration example the scaffolder prints', () => {
  it('names a block that installing the library actually delivers', () => {
    expect(base.registryDependencies).toContain(`@p1/${EXAMPLE_BLOCK}`);
  });

  it('matches the lines the registry serves for that block', () => {
    const served = blocks.find((item) => item.name === EXAMPLE_BLOCK)?.docs ?? '';
    for (const line of EXAMPLE_REGISTRATION.filter(Boolean)) {
      // Registry docs put comments on their own line; EXAMPLE_REGISTRATION inlines them.
      expect(served).toContain(line.replace(/\s+\/\/.*$/, ''));
    }
  });

  it('is the same example the library item itself prints', () => {
    for (const line of EXAMPLE_REGISTRATION.filter(Boolean)) expect(base.docs).toContain(line);
  });

  it('is the same example the shipped README documents', () => {
    // template-assets/README.md is copied into the customer's project, so a stale
    // example there outlives the terminal output they saw once.
    const readme = readFileSync(join(import.meta.dirname, '../template-assets/README.md'), 'utf-8');
    for (const line of EXAMPLE_REGISTRATION.filter(Boolean)) expect(readme).toContain(line);
  });

  it('is the same example this package README documents', () => {
    // npm ships and renders README.md whatever `files` says, so this is the copy
    // on the package page. It had already dropped the duplicate-key line, which
    // is the silent overwrite the rest of the docs warn about.
    const readme = readFileSync(join(import.meta.dirname, '../README.md'), 'utf-8');
    for (const line of EXAMPLE_REGISTRATION.filter(Boolean)) expect(readme).toContain(line);
  });
});
