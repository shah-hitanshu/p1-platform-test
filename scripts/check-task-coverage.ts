#!/usr/bin/env tsx
/**
 * Fails if any workspace package is missing a `lint` or `typecheck` script.
 *
 * Turbo silently reports success for tasks that do not exist, so a package with
 * no `typecheck` script looks identical to one that passes. This makes the gap
 * loud, and forces every exemption to be written down with a reason.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkspaceProject {
  name: string;
  path: string;
}

const REQUIRED_TASKS = ['lint', 'typecheck'] as const;
type RequiredTask = (typeof REQUIRED_TASKS)[number];

const EXEMPTIONS: Record<string, Partial<Record<RequiredTask, string>>> = {
  'p1-platform': {
    lint: 'root delegates to turbo; repo-level files are covered by the lint:root task',
    typecheck: 'root has no sources of its own',
  },
  '@pantheon-systems/eslint-config': {
    typecheck: 'flat-config package with no TypeScript sources',
  },
  '@pantheon-systems/create-p1-starter-kit': {
    typecheck: 'JS-only CLI; enabling checkJs surfaces 35 errors, tracked for the fix phase',
  },
};

function listWorkspaceProjects(): WorkspaceProject[] {
  const raw = execFileSync('pnpm', ['-r', 'list', '--depth', '-1', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return (JSON.parse(raw) as WorkspaceProject[]).filter((p) => p.name && p.path);
}

function main(): void {
  const missing: string[] = [];
  const exempt: string[] = [];

  for (const project of listWorkspaceProjects()) {
    const pkg = JSON.parse(readFileSync(join(project.path, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    for (const task of REQUIRED_TASKS) {
      if (pkg.scripts?.[task]) continue;
      const reason = EXEMPTIONS[project.name]?.[task];
      if (reason) {
        exempt.push(`  ${project.name} — no ${task}: ${reason}`);
      } else {
        missing.push(`  ${project.name} is missing a "${task}" script`);
      }
    }
  }

  if (exempt.length > 0) {
    console.log(`Exempt (${exempt.length}):`);
    console.log(exempt.join('\n'));
  }

  if (missing.length > 0) {
    console.error(`\nMissing required scripts (${missing.length}):`);
    console.error(missing.join('\n'));
    console.error(
      '\nEvery package must have lint and typecheck scripts. Add them, or add an\n' +
        'exemption with a reason to EXEMPTIONS in scripts/check-task-coverage.ts.'
    );
    process.exit(1);
  }

  console.log('\nAll workspace packages have lint and typecheck scripts.');
}

main();
