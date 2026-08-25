import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyTemplate, getScaffolderVersion, restoreGitignore } from './copy-template.js';

describe('copyTemplate', () => {
  let targetDir;

  beforeEach(() => {
    targetDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-')), 'my-app');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(targetDir), { recursive: true, force: true });
  });

  it('stamps the project name and scaffolder version into package.json', () => {
    copyTemplate(targetDir, 'my-app');

    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('my-app');
    expect(pkg.p1.templateVersion).toBe(getScaffolderVersion());
  });
});

describe('getScaffolderVersion', () => {
  it('returns the version from this package manifest', () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
    );
    expect(getScaffolderVersion()).toBe(manifest.version);
  });
});

describe('gitignore', () => {
  let targetDir;

  beforeEach(() => {
    targetDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-')), 'my-app');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(targetDir), { recursive: true, force: true });
  });

  it('restores the dotted name so the initial commit excludes node_modules', () => {
    copyTemplate(targetDir, 'my-app');

    expect(fs.existsSync(path.join(targetDir, 'gitignore'))).toBe(false);
    expect(fs.readFileSync(path.join(targetDir, '.gitignore'), 'utf-8')).toContain('/node_modules');
  });

  it('refuses to scaffold from a template with no gitignore', () => {
    const stripped = fs.mkdtempSync(path.join(os.tmpdir(), 'no-gitignore-'));

    expect(() => restoreGitignore(stripped)).toThrow(/missing gitignore/);

    fs.rmSync(stripped, { recursive: true, force: true });
  });
});

describe('README', () => {
  it('stamps the project name into the scaffolded README', () => {
    const targetDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-')), 'acme-site');

    copyTemplate(targetDir, 'acme-site');
    const readme = fs.readFileSync(path.join(targetDir, 'README.md'), 'utf-8');

    expect(readme).toContain('# acme-site');
    expect(readme).not.toContain('PLACEHOLDER_PROJECT_NAME');

    fs.rmSync(path.dirname(targetDir), { recursive: true, force: true });
  });
});
