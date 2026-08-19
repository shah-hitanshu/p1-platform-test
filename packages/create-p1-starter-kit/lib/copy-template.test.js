import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyTemplate, getScaffolderVersion } from './copy-template.js';

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
