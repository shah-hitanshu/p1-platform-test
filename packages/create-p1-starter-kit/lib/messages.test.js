import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showSuccess, EXAMPLE_REGISTRATION } from './messages.js';

describe('showSuccess', () => {
  let output;

  beforeEach(() => {
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
  });

  it('shows "npm run dev" for npm users', () => {
    showSuccess('my-app', '/tmp/my-app', 'npm');
    const allOutput = output.join('\n');
    expect(allOutput).toContain('npm run dev');
  });

  it('shows "pnpm dev" for pnpm users', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm');
    const allOutput = output.join('\n');
    expect(allOutput).toContain('pnpm dev');
  });

  it('shows "yarn dev" for yarn users', () => {
    showSuccess('my-app', '/tmp/my-app', 'yarn');
    const allOutput = output.join('\n');
    expect(allOutput).toContain('yarn dev');
  });
});

describe('showSuccess with the component library', () => {
  let output;

  beforeEach(() => {
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
  });

  it('reports how many blocks landed', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 29 });
    expect(output.join('\n')).toContain('29');
  });

  it('shows the registration lines rather than sending you to the catalog', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 29 });
    const all = output.join('\n');
    expect(all).toContain('components/puck/blocks/index.ts');
    for (const line of EXAMPLE_REGISTRATION.filter(Boolean)) expect(all).toContain(line);
    expect(all).not.toContain('components.p1.pantheon.io');
  });

  it('says to repeat the three lines per block', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 29 });
    expect(output.join('\n')).toMatch(/Repeat for each block/);
  });

  it('tells you how to add blocks later when you declined', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 0 });
    expect(output.join('\n')).toContain('shadcn@latest add @p1/base');
  });

  it('says the install prints the registration lines, on the opt-out path too', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 0 });
    expect(output.join('\n')).toContain('components/puck/blocks/index.ts');
  });

  it('says the install did not finish when only some blocks landed', () => {
    // Otherwise the closing message offers the library as though nothing were
    // installed, two lines after a warning naming what is already on disk.
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 2, p1BlocksPartial: true });
    const all = output.join('\n');
    expect(all).toMatch(/did not finish/);
    expect(all).toContain('pnpm dlx shadcn@latest add @p1/base');
    expect(all).not.toContain('any time');
  });

  it('still explains how to register the blocks that did land', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 2, p1BlocksPartial: true });
    const all = output.join('\n');
    expect(all).toContain('2 P1 blocks');
    for (const line of EXAMPLE_REGISTRATION.filter(Boolean)) expect(all).toContain(line);
  });

  it('says nothing about a partial install when every block landed', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 29 });
    expect(output.join('\n')).not.toMatch(/did not finish/);
  });

  // The namespace is stamped at build time. Were it to change, a hardcoded
  // @p1 here would name a registry the generated components.json never defines,
  // so the command the user copies would fail on an unknown registry.
  it.each([
    ['the recovery command after a partial install', { p1Blocks: 2, p1BlocksPartial: true }],
    ['the opt-out command', { p1Blocks: 0 }],
  ])('takes the registry namespace from the caller in %s', (_label, options) => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { ...options, registryNamespace: '@acme' });
    const all = output.join('\n');
    expect(all).toContain('shadcn@latest add @acme/base');
    expect(all).not.toContain('@p1/base');
  });
});

describe('showSuccess opt-out commands per package manager', () => {
  let output;

  beforeEach(() => {
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
  });

  it('uses npx and `run` for npm, which has no dlx', () => {
    showSuccess('my-app', '/tmp/my-app', 'npm', { p1Blocks: 0 });
    const all = output.join('\n');
    expect(all).toContain('npx shadcn@latest add @p1/base');
    expect(all).not.toContain('npm dlx');
  });

  it('uses dlx for pnpm', () => {
    showSuccess('my-app', '/tmp/my-app', 'pnpm', { p1Blocks: 0 });
    const all = output.join('\n');
    expect(all).toContain('pnpm dlx shadcn@latest add @p1/base');
  });
});
