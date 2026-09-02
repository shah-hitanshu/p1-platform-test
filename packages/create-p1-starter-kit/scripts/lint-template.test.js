import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lintTemplate } from './lint-template.js';

let fixture;

// A minimal stand-in for a built template: the rules need a package.json to know
// which dependencies a scaffold installs, and nothing else.
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-template-'));
  write(
    'package.json',
    JSON.stringify({
      name: 'PLACEHOLDER_PROJECT_NAME',
      dependencies: { '@pantheon-systems/puck-css': '^0.13.0' },
    })
  );
});

afterEach(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});

function write(file, contents) {
  const full = path.join(fixture, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

const rulesFired = () => lintTemplate(fixture).map((v) => v.rule);

describe('escapes-project-root', () => {
  it('catches the split-argument path form that shipped dead vitest aliases', () => {
    write(
      'vitest.config.ts',
      'export default { resolve: { alias: { x: resolve(__dirname, "../..", "packages/puck-css/src/data/fields.tsx") } } };'
    );

    expect(rulesFired()).toEqual(['escapes-project-root']);
  });

  it('catches a monorepo-relative path written as one literal', () => {
    write('lib/thing.ts', 'import x from "../../packages/puck-css/src/index.js";');

    expect(rulesFired()).toEqual(['escapes-project-root']);
  });

  it('catches a Tailwind @source pointing out of the project', () => {
    write('app/styles.css', '@source "../../../packages/puck-css/dist";');

    expect(rulesFired()).toEqual(['escapes-project-root']);
  });

  it('allows a deep relative import that stays inside the project', () => {
    write('app/p1/merge/merge-client.tsx', 'import config from "../../../puck.config";');

    expect(rulesFired()).toEqual([]);
  });

  it('allows a test reading a file at the project root', () => {
    write('__tests__/readme.test.ts', 'readFileSync(resolve(__dirname, "../package.json"));');

    expect(rulesFired()).toEqual([]);
  });
});

describe('workspace-specifier', () => {
  it('catches a specifier the manifest transform missed', () => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { '@pantheon-systems/puck-css': 'workspace:*' } })
    );

    expect(rulesFired()).toEqual(['workspace-specifier']);
  });

  it('catches one outside the manifest, where the existing checks do not look', () => {
    write('pnpm-workspace.yaml', 'overrides:\n  "@pantheon-systems/puck-css": "workspace:*"\n');

    expect(rulesFired()).toEqual(['workspace-specifier']);
  });
});

describe('undeclared-internal-package', () => {
  it('names the package as private when it is a private workspace package', () => {
    write('eslint.config.js', 'import base from "@pantheon-systems/eslint-config/base";');

    const [violation] = lintTemplate(fixture);
    expect(violation.rule).toBe('undeclared-internal-package');
    expect(violation.message).toContain('@pantheon-systems/eslint-config');
    expect(violation.message).toContain('private');
  });

  it('catches an internal package that is merely undeclared', () => {
    write('lib/log.ts', 'import { getLogger } from "@pantheon-systems/p1-telemetry";');

    expect(rulesFired()).toEqual(['undeclared-internal-package']);
  });

  it('allows a subpath of a declared dependency', () => {
    write('lib/fields.ts', 'import { getByDotPath } from "@pantheon-systems/puck-css/fields";');

    expect(rulesFired()).toEqual([]);
  });

  it('ignores a package named in prose rather than imported', () => {
    write('README.md', 'This project depends on "@pantheon-systems/eslint-config" internally.');

    expect(rulesFired()).toEqual([]);
  });

  it('ignores the marker comments the eslint inliner leaves behind', () => {
    write('eslint.config.js', '// @pantheon-systems/eslint-config/base\nexport default [];');

    expect(rulesFired()).toEqual([]);
  });
});

describe('reporting', () => {
  it('reports the file and line so the offender is findable', () => {
    write('lib/thing.ts', 'const a = 1;\nimport x from "../../packages/x";');

    expect(lintTemplate(fixture)[0]).toMatchObject({ file: 'lib/thing.ts', line: 2 });
  });

  it('refuses to pass silently when no template has been built', () => {
    expect(() => lintTemplate(path.join(fixture, 'nope'))).toThrow(/No built template/);
  });
});
