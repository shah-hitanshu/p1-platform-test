import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('treats the first bare argument as the project name', () => {
    expect(parseArgs(['my-app'])).toMatchObject({ projectName: 'my-app', yes: false });
  });

  it('defaults every choice to undefined so prompts still run', () => {
    expect(parseArgs([])).toEqual({
      projectName: undefined,
      yes: false,
      pm: undefined,
      git: undefined,
      install: undefined,
    });
  });

  it('accepts --yes and -y', () => {
    expect(parseArgs(['--yes']).yes).toBe(true);
    expect(parseArgs(['-y']).yes).toBe(true);
  });

  it('accepts --pm as a separate value or with =', () => {
    expect(parseArgs(['--pm', 'pnpm']).pm).toBe('pnpm');
    expect(parseArgs(['--pm=npm']).pm).toBe('npm');
  });

  it('rejects an unknown package manager', () => {
    expect(() => parseArgs(['--pm', 'bun'])).toThrow(/--pm must be one of/);
    expect(() => parseArgs(['--pm'])).toThrow(/--pm must be one of/);
  });

  it('parses git and install toggles', () => {
    expect(parseArgs(['--git']).git).toBe(true);
    expect(parseArgs(['--no-git']).git).toBe(false);
    expect(parseArgs(['--install']).install).toBe(true);
    expect(parseArgs(['--no-install']).install).toBe(false);
  });

  it('rejects unknown options and extra positionals', () => {
    expect(() => parseArgs(['--frobnicate'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['app-one', 'app-two'])).toThrow(/Unexpected argument/);
  });

  it('parses a full non-interactive invocation', () => {
    expect(parseArgs(['my-app', '--yes', '--pm', 'pnpm', '--no-git', '--no-install'])).toEqual({
      projectName: 'my-app',
      yes: true,
      pm: 'pnpm',
      git: false,
      install: false,
    });
  });
});
