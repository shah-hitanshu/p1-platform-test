import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showSuccess } from './messages.js';

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
