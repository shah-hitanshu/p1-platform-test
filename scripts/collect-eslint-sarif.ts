#!/usr/bin/env tsx
/**
 * Converts the per-package ESLint JSON reports that `turbo run lint` scatters
 * across the workspace into a single SARIF run for upload.
 *
 * One run, not one per package: code scanning rejects multiple runs sharing a
 * category, and stopped combining them in July 2025.
 *
 * Written by hand rather than with `@microsoft/eslint-formatter-sarif`, which
 * marks a file's *active* findings as suppressed whenever that file contains
 * any `eslint-disable` comment. Code scanning ingests those as dismissed, so
 * the warnings most worth seeing are the ones that disappear.
 *
 * Paths are emitted relative to the repository root; code scanning cannot map
 * absolute ones back to files in the repo.
 */
import { readFileSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const OUT_FILE = join(REPO_ROOT, 'sarif', 'eslint.sarif');
const REPORT_NAME = 'eslint-report.json';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo', '.next', 'sarif']);

interface EslintMessage {
  ruleId: string | null;
  message: string;
  severity: 1 | 2;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
  suppressedMessages?: EslintMessage[];
}

interface EslintReport {
  results: EslintFileResult[];
  metadata?: { rulesMeta?: Record<string, { docs?: { description?: string; url?: string } }> };
}

function findReports(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...findReports(join(dir, entry.name)));
    } else if (entry.name === REPORT_NAME) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

// SARIF regions are 1-based and reject 0; ESLint omits position on some fatals.
function toRegion(message: EslintMessage): Record<string, number> | undefined {
  if (!message.line) return undefined;
  const region: Record<string, number> = { startLine: message.line };
  if (message.column) region.startColumn = message.column;
  if (message.endLine) region.endLine = message.endLine;
  if (message.endColumn) region.endColumn = message.endColumn;
  return region;
}

// Accumulates every package's findings into one run; rule indices are global.
const ruleIndex = new Map<string, number>();
const rules: unknown[] = [];
const results: unknown[] = [];

function addReport(report: EslintReport): { open: number; suppressed: number } {
  let open = 0;
  let suppressed = 0;

  const addResult = (file: EslintFileResult, message: EslintMessage) => {
    const result: Record<string, unknown> = {
      level: message.severity === 2 ? 'error' : 'warning',
      message: { text: message.message },
      locations: [
        {
          physicalLocation: {
            // encodeURI leaves `/` and `()` alone but escapes the brackets in
            // Next.js route segments like `[[...p1]]`, which a URI may not hold raw.
            artifactLocation: {
              uri: encodeURI(relative(REPO_ROOT, file.filePath).split(sep).join('/')),
            },
            ...(toRegion(message) ? { region: toRegion(message) } : {}),
          },
        },
      ],
    };

    if (message.ruleId) {
      if (!ruleIndex.has(message.ruleId)) {
        const meta = report.metadata?.rulesMeta?.[message.ruleId];
        ruleIndex.set(message.ruleId, rules.length);
        rules.push({
          id: message.ruleId,
          ...(meta?.docs?.description
            ? { shortDescription: { text: meta.docs.description } }
            : {}),
          ...(meta?.docs?.url ? { helpUri: meta.docs.url } : {}),
        });
      }
      result.ruleId = message.ruleId;
      result.ruleIndex = ruleIndex.get(message.ruleId);
    }

    open += 1;
    results.push(result);
  };

  // Suppressed findings are counted but not emitted. Code scanning ignores SARIF
  // `suppressions` and opens an alert anyway, so shipping them turns every
  // deliberate `eslint-disable` into a permanent alert.
  for (const file of report.results) {
    for (const message of file.messages) addResult(file, message);
    suppressed += file.suppressedMessages?.length ?? 0;
  }

  return { open, suppressed };
}

const reports = findReports(REPO_ROOT);
if (reports.length === 0) {
  console.error(`No ${REPORT_NAME} files found — did the lint run write them?`);
  process.exit(1);
}

rmSync(join(OUT_FILE, '..'), { recursive: true, force: true });
mkdirSync(join(OUT_FILE, '..'), { recursive: true });

let totalOpen = 0;
let totalSuppressed = 0;
for (const report of reports) {
  const parsed = JSON.parse(readFileSync(report, 'utf8')) as EslintReport;
  const { open, suppressed } = addReport(parsed);

  const pkgDir = relative(REPO_ROOT, join(report, '..'));
  const slug = pkgDir === '' ? 'root' : pkgDir.split(sep).join('-');

  totalOpen += open;
  totalSuppressed += suppressed;
  console.log(`${slug}: ${open} reported, ${suppressed} suppressed in source`);
}

writeFileSync(
  OUT_FILE,
  JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'ESLint', informationUri: 'https://eslint.org', rules } },
        results,
      },
    ],
  })
);

console.log(
  `\n${totalOpen} reported, ${totalSuppressed} suppressed in source and omitted, ` +
    `across ${reports.length} packages — one run, ${rules.length} rules → ${relative(REPO_ROOT, OUT_FILE)}`
);
