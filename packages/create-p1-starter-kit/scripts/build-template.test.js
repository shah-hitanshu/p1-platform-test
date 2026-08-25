import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTemplate } from './build-template.js';

// One build shared by the whole file: it copies the entire starter app.
let built;

beforeAll(() => {
  built = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'build-template-')), 'template');
  buildTemplate(built);
});

afterAll(() => {
  fs.rmSync(path.dirname(built), { recursive: true, force: true });
});

const read = (file) => fs.readFileSync(path.join(built, file), 'utf-8');
const exists = (file) => fs.existsSync(path.join(built, file));

describe('buildTemplate', () => {
  it('ships the gitignore undotted so npm does not strip it from the tarball', () => {
    expect(exists('gitignore')).toBe(true);
    expect(exists('.gitignore')).toBe(false);
    expect(read('gitignore')).toContain('/node_modules');
  });

  it('ships a README written for scaffold consumers, not the monorepo one', () => {
    expect(read('README.md')).not.toContain('Content Publisher Site Sample');
    expect(read('README.md')).toContain('PLACEHOLDER_PROJECT_NAME');
  });

  it('does not ship the monorepo changelog', () => {
    expect(exists('CHANGELOG.md')).toBe(false);
  });

  it('inlines every eslint preset the starter app composes, tests included', () => {
    const config = read('eslint.config.js');

    expect(config).toContain('// @pantheon-systems/eslint-config/base');
    expect(config).toContain('// @pantheon-systems/eslint-config/react');
    expect(config).toContain('// @pantheon-systems/eslint-config/prettier');
    expect(config).toContain('// @pantheon-systems/eslint-config/tests');
    expect(config).not.toContain('@pantheon-systems/eslint-config/tests\';');
  });

  it('leaves no unresolved workspace protocol in the manifest', () => {
    const pkg = JSON.parse(read('package.json'));
    const specifiers = Object.values({ ...pkg.dependencies, ...pkg.devDependencies });

    expect(specifiers.filter((s) => s.startsWith('workspace:'))).toEqual([]);
    expect(pkg.devDependencies['@pantheon-systems/eslint-config']).toBeUndefined();
  });
});

// The previous README was copied from the monorepo's and had drifted: it documented
// two optional Content Publisher variables as the required credentials, and three
// paths that no longer existed. Prose drifts silently, so assert it against the build.
describe('the scaffold README describes the template it ships with', () => {
  const fence = (heading) =>
    new RegExp(`## ${heading}\\n+\`\`\`\\n([\\s\\S]*?)\`\`\``).exec(read('README.md'))?.[1] ?? '';

  it('names only paths that exist', () => {
    const stack = [];
    const claimed = [];

    for (const line of fence('Project structure').split('\n')) {
      const entry = /^(\s*)(\S+?)\/?(\s+#.*)?$/.exec(line);
      if (!entry) continue;

      const depth = entry[1].length / 2;
      stack.length = depth;
      stack.push(entry[2].replace(/\/$/, ''));
      claimed.push(stack.join('/'));
    }

    expect(claimed.length).toBeGreaterThan(5);
    expect(claimed.filter((p) => !exists(p))).toEqual([]);
  });

  // Scoped to the setup section: elsewhere an ALL_CAPS token is a code symbol.
  const setupSection = () => /## Getting started\n([\s\S]*?)\n## /.exec(read('README.md'))[1];
  const envVars = (pattern) => [...read('.env.example').matchAll(pattern)].map((m) => m[1]);

  it('presents as required only the variables .env.example leaves uncommented', () => {
    // The original defect: PCC_SITE_ID and PCC_TOKEN are real variables, but they are
    // commented out as an optional integration — being in the file is not enough.
    const active = envVars(/^([A-Z][A-Z0-9_]*)=/gm);
    const rows = [...setupSection().matchAll(/^\s*\| `([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]);

    expect(rows).toContain('CSS_API_KEY');
    expect(rows.filter((v) => !active.includes(v))).toEqual([]);
  });

  it('mentions no variable the app does not have at all', () => {
    const known = envVars(/^#?\s*([A-Z][A-Z0-9_]*)=/gm);
    const named = [...setupSection().matchAll(/`([A-Z][A-Z0-9_]{4,})`/g)].map((m) => m[1]);

    expect(named.length).toBeGreaterThan(2);
    expect(named.filter((v) => !known.includes(v))).toEqual([]);
  });

  it('names only scripts the manifest defines', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    const named = [...read('README.md').matchAll(/`npm run ([\w:]+)`/g)].map((m) => m[1]);

    expect(named.length).toBeGreaterThan(3);
    expect(named.filter((s) => !(s in scripts))).toEqual([]);
  });
});

describe('build artifacts', () => {
  // Both are gitignored in apps/p1-starter, so nothing in the repo caught them
  // shipping. The tsbuildinfo was 466KB of paths into this monorepo's node_modules.
  it.each(['tsconfig.tsbuildinfo', 'next-env.d.ts'])('does not ship %s', (file) => {
    expect(exists(file)).toBe(false);
  });

  it('ships no incremental-build cache under any tsconfig name', () => {
    const stale = fs
      .readdirSync(built, { recursive: true })
      .filter((entry) => String(entry).endsWith('.tsbuildinfo'));

    expect(stale).toEqual([]);
  });
});
