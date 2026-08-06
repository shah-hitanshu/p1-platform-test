#!/usr/bin/env tsx
/**
 * Holds the test-only type-error count to a committed ceiling.
 *
 * Production code type-checks clean and is gated normally. Test code does not
 * yet, and the repo has already tried the alternative: `base.js` parked ~35
 * rules at `warn` under a "resolve over time" comment and accumulated 378
 * warnings in four months, because nothing ever failed. A count nobody enforces
 * is the `known-issues` job with extra steps.
 *
 * So the count may fall freely and may never rise. When it falls, this fails
 * too — with the new number to commit — so the ceiling tracks reality instead
 * of drifting into slack.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Baseline {
  /** Highest number of test type errors CI will accept. */
  maxErrors: number;
  packages: string[];
}

const BASELINE_PATH = join(import.meta.dirname, '..', 'typecheck-tests-baseline.json');
const ERROR_LINE = /error TS\d+:/;
/** A type error, which always carries a file position: `path(line,col): error TSxxxx:`. */
const POSITIONED_ERROR = /^\S.*\(\d+,\d+\): error TS\d+:/;
/** tsc's summary, present only in pretty mode: "Found 768 errors in 92 files." */
const ERROR_SUMMARY = /Found (\d+) errors? in/;

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

/**
 * Counts test type errors in one package, or exits rather than guessing.
 *
 * Every way this can fail short of "tsc ran and reported errors" has to be
 * loud. A silent 0 here reads as an improvement, which lowers the committed
 * ceiling to 0 — and from then on 0 === 0 passes forever, so the gate deletes
 * itself and stays green.
 */
function countErrors(packageDir: string): number {
  // NO_COLOR because tsc colourises when stdout is a TTY, and the ANSI codes it
  // puts between "error" and "TSxxxx:" stop ERROR_LINE matching. Relying on
  // `stdio: 'pipe'` for that leaves the count one refactor away from zero.
  // (Passing `--pretty false` through `pnpm run` is not an option: pnpm forwards
  // the `--` itself and tsc rejects it as an unknown compiler option.)
  // FORCE_COLOR has to go, not just NO_COLOR come in: node warns "NO_COLOR is
  // ignored due to FORCE_COLOR being set" and colourises anyway. A developer
  // with FORCE_COLOR in their shell is otherwise measuring something else.
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.FORCE_COLOR;

  let result: { status: number | null; stdout: string; stderr: string };
  try {
    const stdout = execFileSync('pnpm', ['run', 'typecheck:tests'], {
      cwd: packageDir,
      encoding: 'utf8',
      stdio: 'pipe',
      env,
    });
    result = { status: 0, stdout, stderr: '' };
  } catch (error) {
    const spawned = error as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
      code?: string;
    };
    if (spawned.code !== undefined) {
      fail(`${packageDir}: could not run typecheck:tests (${spawned.code}). Is the path right?`);
    }
    result = {
      status: spawned.status ?? null,
      stdout: spawned.stdout ?? '',
      stderr: spawned.stderr ?? '',
    };
  }

  if (result.status === 0) {
    return 0;
  }

  const errorLines = result.stdout.split('\n').filter((line) => ERROR_LINE.test(line));
  const counted = errorLines.filter((line) => POSITIONED_ERROR.test(line)).length;
  const summary = ERROR_SUMMARY.exec(result.stdout);

  if (counted === 0) {
    fail(
      `${packageDir}: typecheck:tests exited ${String(result.status)} without any parseable ` +
        `"error TSxxxx:" lines, so the count cannot be trusted. Output:\n` +
        `${(result.stdout + result.stderr).trim().slice(0, 2000)}`
    );
  }

  // A config-level error (`error TS5023: Unknown compiler option`) has no file
  // position. It means tsc never type-checked, so any count here is fiction —
  // and it is small enough to look like a triumph.
  const unpositioned = errorLines.filter((line) => !POSITIONED_ERROR.test(line));
  if (unpositioned.length > 0) {
    fail(
      `${packageDir}: tsc reported ${String(unpositioned.length)} error(s) with no file ` +
        `position, so this run is a misconfiguration rather than a measurement:\n` +
        `${unpositioned.slice(0, 5).join('\n')}`
    );
  }

  // tsc tells us how many it found; disagreeing means the parse missed some.
  if (summary && Number(summary[1]) !== counted) {
    fail(
      `${packageDir}: tsc reported ${summary[1]} errors but ${String(counted)} lines parsed. ` +
        `The output format changed — fix the parser before trusting the ceiling.`
    );
  }

  return counted;
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
const repoRoot = join(import.meta.dirname, '..');

let total = 0;
for (const pkg of baseline.packages) {
  const count = countErrors(join(repoRoot, pkg));
  console.log(`${pkg}: ${count}`);
  total += count;
}

console.log(`\nTotal ${total}, ceiling ${baseline.maxErrors}`);

if (total > baseline.maxErrors) {
  console.error(
    `\nTest type errors rose by ${total - baseline.maxErrors}. ` +
      `Fix the new ones — the ceiling only moves down.`,
  );
  process.exit(1);
}

if (total < baseline.maxErrors) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ ...baseline, maxErrors: total }, null, 2)}\n`);
  const message =
    `\nDown ${baseline.maxErrors - total} from the ceiling. ` +
    `typecheck-tests-baseline.json has been lowered to ${total} — commit it.`;

  // On a PR, failing is the point: it is how the new number gets committed.
  // On main the drop is already merged, and two PRs that each lowered the count
  // off a shared base land below whichever ceiling merged last — so failing
  // here reddens main for a strict improvement. Warn instead; the next PR
  // commits the number. (This write is discarded with the CI workspace either
  // way, so main's baseline stays stale until then.)
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    console.warn(message);
  } else {
    console.error(message);
    process.exit(1);
  }
}

console.log('At the ceiling.');
