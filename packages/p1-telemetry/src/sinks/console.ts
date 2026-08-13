/**
 * Console sink — the only sink deployed workers use.
 *
 * Deployed workers do NOT push to Grafana themselves. They write one JSON line per
 * event to stdout/stderr, and a tail-consumer worker reads those lines and pushes to
 * Loki. That keeps the credential in one place and, more importantly, still captures
 * the exception from a request that crashed before any in-process exporter could flush.
 *
 * Two renderers, same event: `json` for anything a machine parses, `pretty` for a
 * human watching a dev terminal.
 */

import type { LogLine, Sink } from '../types/index.js';

export type ConsoleFormat = 'json' | 'pretty';

/* eslint-disable no-console -- this is the one module allowed to touch console;
   everything else goes through the logger. */
const METHOD: Record<LogLine['level'], (...args: unknown[]) => void> = {
  // Workers Logs derives a line's level from which console method was called, so this
  // mapping is load-bearing rather than cosmetic.
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
/* eslint-enable no-console */

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const LEVEL_COLOR: Record<LogLine['level'], string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

function timeOfDay(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

/**
 * A stack already begins with `Name: message`, so printing both duplicates it. Cause
 * chains are followed because that's usually where the real failure is.
 */
function renderError(err: LogLine['err'], color: boolean): string {
  if (!err) return '';
  const dim = (text: string): string => (color ? `${DIM}${text}${RESET}` : text);
  let out = `\n${dim(err.stack ?? `${err.name}: ${err.message}`)}`;
  let cause = err.cause;
  while (cause) {
    out += `\n${dim(`caused by: ${cause.name}: ${cause.message}`)}`;
    cause = cause.cause;
  }
  return out;
}

function renderPretty(line: LogLine, color: boolean): string {
  const paint = (code: string, text: string): string => (color ? `${code}${text}${RESET}` : text);
  const level = line.level.toUpperCase().padEnd(5);
  const head = `${paint(DIM, timeOfDay(line.ts))} ${paint(LEVEL_COLOR[line.level], level)} ${line['service.name']}`;

  const parts: string[] = [];
  // Short labels in the human view; the JSON keeps the semconv names.
  const route = line['http.route'];
  if (route) parts.push(`route=${route}`);
  if (line.trace_id) parts.push(`trace=${line.trace_id.slice(0, 8)}`);
  for (const [key, value] of Object.entries(line.context ?? {})) {
    if (key === '_dropped') {
      // Surfaced rather than hidden: "the field you were looking for was filtered" is
      // the whole reason the allow-list records names.
      parts.push(`dropped=${(value as string[]).join(',')}`);
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  if (line.unhandled) parts.push('UNHANDLED');

  const tail = parts.length > 0 ? ` ${paint(DIM, parts.join(' '))}` : '';
  return `${head} ${line.msg}${tail}${renderError(line.err, color)}`;
}

export function createConsoleSink(options: { format: ConsoleFormat; color?: boolean }): Sink {
  const color = options.color ?? true;
  return {
    id: 'console',
    write(line) {
      if (options.format === 'pretty') {
        METHOD[line.level](renderPretty(line, color));
        return;
      }
      // A single object, not a pre-stringified line: the tail consumer receives the
      // argument structurally, so stringifying here would force it to re-parse and
      // would double-encode into the Loki line.
      METHOD[line.level](line);
    },
    async flush() {
      // console is synchronous; nothing to drain.
    },
  };
}
