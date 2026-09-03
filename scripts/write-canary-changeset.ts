#!/usr/bin/env tsx
/**
 * Writes one changeset naming every publishable package, for the canary build to
 * consume.
 *
 * `changeset version --snapshot` bumps only packages that have a pending changeset,
 * and a canary is cut against whatever is on main rather than against a release — so
 * packages with nothing pending would keep their last stable version and publish
 * nothing. A `@canary` tag that points at current code for some packages and last
 * month's for others is worse than none. Naming every package makes the tag mean
 * "main, as of this run" across the board.
 *
 * The file is written into the workflow's throwaway checkout and never committed; a
 * snapshot run publishes no commit, tag, or CHANGELOG.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { sep } from 'node:path';

interface WorkspaceProject {
  name: string;
  path: string;
  private: boolean;
}

const CHANGESET_PATH = `.changeset${sep}canary-snapshot.md`;

function publishablePackages(): string[] {
  const listed = execFileSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  return (JSON.parse(listed) as WorkspaceProject[])
    .filter((project) => project.path.includes(`${sep}packages${sep}`) && !project.private)
    .map((project) => project.name)
    .sort();
}

const packages = publishablePackages();

if (packages.length === 0) {
  process.stderr.write('No publishable packages found under packages/.\n');
  process.exit(1);
}

const frontmatter = packages.map((name) => `'${name}': patch`).join('\n');

writeFileSync(
  CHANGESET_PATH,
  `---\n${frontmatter}\n---\n\nCanary build from main. Not a release.\n`
);

process.stdout.write(`[write-canary-changeset] ${CHANGESET_PATH}\n`);
for (const name of packages) process.stdout.write(`  ${name}\n`);
