import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeComponentsJson,
  recoveryCommand,
  installedBlockNames,
  installP1Blocks,
} from './install-p1-blocks.js';
import { dlxCommand, dlxInvocation, dlxRunnerFor } from './install-deps.js';

const EMPTY_BARREL = `import type { ComponentConfig, Config } from "@puckeditor/core";

export const p1Blocks: Record<string, ComponentConfig<any>> = {};

export const p1Categories: NonNullable<Config["categories"]> = {};
`;

const REGISTRY = { namespace: '@p1', url: 'https://example.test/r/{name}.json', release: 'v0.1.0' };

let dir;

const pascalish = (s) =>
  s
    .split('-')
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');

/** A copied template, plus whichever block directories the test wants. */
function scaffold(blockNames = []) {
  dir = mkdtempSync(join(tmpdir(), 'p1-install-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  mkdirSync(join(dir, 'components/puck/blocks'), { recursive: true });
  writeFileSync(join(dir, 'components/puck/blocks/index.ts'), EMPTY_BARREL);
  writeFileSync(join(dir, 'app/styles.css'), '@import "tailwindcss";\n\nbody { margin: 0; }\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-p1-app' }, null, 2) + '\n');
  for (const entry of blockNames) {
    // A block is either 'hero' (export derives from the name) or
    // ['logos', 'LogoCloudBlock', ['showcase']] where it does not.
    const [name, exported, categories] = Array.isArray(entry)
      ? entry
      : [entry, pascalish(entry) + 'Block', []];
    mkdirSync(join(dir, 'components/puck/blocks', name), { recursive: true });
    writeFileSync(
      join(dir, 'components/puck/blocks', name, `${name}.block.tsx`),
      `export const meta = defineMeta({ categories: [${categories.map((c) => `"${c}"`).join(',')}] });\n` +
        `export const ${exported}: ComponentConfig<Props> = {};\n`,
    );
  }
  return dir;
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (file) => readFileSync(join(dir, file), 'utf-8');

describe('writeComponentsJson', () => {
  beforeEach(() => {
    scaffold();
    writeComponentsJson(dir, REGISTRY);
  });

  it('writes a components.json registering the namespace', () => {
    expect(JSON.parse(read('components.json')).registries['@p1']).toBe(REGISTRY.url);
  });

  it('points tailwind.css at the project stylesheet', () => {
    expect(JSON.parse(read('components.json')).tailwind.css).toBe('app/styles.css');
  });

  it('does not touch app/styles.css — @p1/tokens injects its own import', () => {
    expect(read('app/styles.css')).not.toContain('p1-tokens');
  });
});


describe('the printed command is always the command that ran', () => {
  // The class of bug this guards: npm has no `dlx`, and neither does Yarn
  // Classic. Two call sites built these strings separately and disagreed.
  it('agrees between the display string and the spawn invocation', () => {
    for (const pm of ['pnpm', 'npm', 'yarn']) {
      const display = dlxCommand(pm, 'shadcn@latest add @p1/base');
      const { command, args } = dlxInvocation(pm, 'shadcn@latest add @p1/base');
      expect(`${command} ${args.join(' ')}`).toBe(display);
    }
  });

  it('never emits `npm dlx`, a command npm does not have', () => {
    expect(dlxCommand('npm', 'x')).toBe('npx x');
    expect(dlxCommand('pnpm', 'x')).toBe('pnpm dlx x');
    // Not asserted for yarn: dlxCommand probes the host's real yarn, so the
    // answer would turn on whether this machine has Berry through corepack.
    // The describe below fixes the major and covers both branches instead.
  });
});


describe('the recovery command a failed install prints', () => {
  // Pure on purpose. This asserts the string, so it must not need the network —
  // the earlier version ran the real installer and timed out in CI.
  it('names a command npm actually has', () => {
    expect(recoveryCommand('npm', '@p1/base')).toBe('npx shadcn@latest add @p1/base');
  });

  it('uses dlx for pnpm', () => {
    expect(recoveryCommand('pnpm', '@p1/base')).toBe('pnpm dlx shadcn@latest add @p1/base');
  });

  it('prints exactly what it would run', () => {
    for (const pm of ['pnpm', 'npm', 'yarn']) {
      const printed = recoveryCommand(pm, '@p1/base');
      const { command, args } = dlxInvocation(pm, 'shadcn@latest add @p1/base');
      expect(`${command} ${args.join(' ')}`).toBe(printed);
    }
  });
});

describe('which one-off runner each manager gets', () => {
  // dlxRunnerFor takes the yarn major rather than probing, so both branches are
  // asserted here regardless of which yarn is installed where this runs. The
  // previous version asserted the Classic branch only and would have gone red
  // on any image shipping Berry.
  it('gives Yarn Classic npx, because dlx does not exist before Yarn 2', () => {
    expect(dlxRunnerFor('yarn', 1)).toBe('npx');
  });

  it('gives Yarn Berry its own dlx', () => {
    expect(dlxRunnerFor('yarn', 2)).toBe('yarn');
    expect(dlxRunnerFor('yarn', 4)).toBe('yarn');
  });

  it('gives npm npx and pnpm its own dlx, whatever yarn is installed', () => {
    for (const major of [1, 2, 4]) {
      expect(dlxRunnerFor('npm', major)).toBe('npx');
      expect(dlxRunnerFor('pnpm', major)).toBe('pnpm');
    }
  });
});


describe('installedBlockNames', () => {
  it('counts the block directories that landed', () => {
    scaffold(['hero', 'pricing']);
    expect(installedBlockNames(dir)).toEqual(['hero', 'pricing']);
  });

  it('skips _-prefixed directories, which are shared deps and not blocks', () => {
    // The scaffold validator asserts this same count in CI. Two filters over the
    // same directory means the number shown to the user can drift from it.
    scaffold(['hero']);
    mkdirSync(join(dir, 'components/puck/blocks/_shared'), { recursive: true });
    expect(installedBlockNames(dir)).toEqual(['hero']);
  });

  it('returns nothing when the directory was never created', () => {
    scaffold();
    rmSync(join(dir, 'components/puck/blocks'), { recursive: true, force: true });
    expect(installedBlockNames(dir)).toEqual([]);
  });
});

describe('when the registry install fails', () => {
  /** installP1Blocks with the package runner stubbed — no network, no child. */
  const run = (result, blocks = []) => {
    scaffold(blocks);
    try {
      installP1Blocks(dir, { registryConfig: REGISTRY, spawn: () => result });
      return null;
    } catch (error) {
      return error.message;
    }
  };

  it('says the install was stopped rather than printing a bare ETIMEDOUT', () => {
    // A killed child looks exactly like a runner that could not launch: status
    // null, both streams empty. Without this the user reads `spawnSync ETIMEDOUT`.
    const message = run({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('spawnSync pnpm ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    });
    expect(message).toContain('No response after 120s');
    expect(message).not.toContain('ETIMEDOUT');
    expect(message).toContain(recoveryCommand('pnpm', '@p1/base'));
  });

  it('names the blocks that landed before it died', () => {
    // Declining leaves a clean project; a failed install must leave a
    // recoverable one, not one that reports itself clean.
    const message = run({ status: 1, stdout: '', stderr: 'ENOTFOUND example.test' }, ['hero', 'pricing']);
    expect(message).toContain('2 block directories already landed');
    expect(message).toContain('hero, pricing');
  });

  it('says nothing about partial state when nothing landed', () => {
    const message = run({ status: 1, stdout: '', stderr: 'ENOTFOUND example.test' });
    expect(message).toContain('ENOTFOUND example.test');
    expect(message).not.toContain('already landed');
  });

  it('leaves components.json in place so the recovery command works', () => {
    run({ status: 1, stdout: '', stderr: 'boom' });
    expect(JSON.parse(read('components.json')).registries['@p1']).toBe(REGISTRY.url);
  });
});
