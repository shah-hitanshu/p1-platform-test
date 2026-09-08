/**
 * Worker logger construction — the `ensureLogger(env)` pattern every worker was
 * hand-rolling as a near-identical `src/telemetry.ts` (ccr, p1-agent, ccr-mcp-server).
 * One `createWorkerTelemetry` call per worker replaces the boilerplate; the worker
 * supplies only what actually differs: its app name, which env var decides
 * `data_class`, and any worker-specific allow-listed log fields.
 *
 * Subpath export (`@pantheon-systems/p1-telemetry/worker`) rather than the main entry,
 * matching `./sinks/http` — this module pulls in the http sink, which non-worker
 * consumers of the main entry don't need.
 */

import { createConsoleSink } from './sinks/console.js';
import { createHttpSink } from './sinks/http.js';
import { initLogger, resolveDataClass, type P1Logger } from './logger.js';
import type { AppName, Level, Sink } from './types/index.js';

/** The bindings the logger reads. A worker's TelemetryEnv extends this with whatever its dataClassUrl needs. */
export interface WorkerTelemetryEnv {
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
  APP_VERSION?: string;
  /** Local ndjson collector, e.g. `http://127.0.0.1:8799`. Unset in every deployed env. */
  P1_LOG_SINK?: string;
}

export interface WorkerTelemetryOptions<E extends WorkerTelemetryEnv> {
  app: AppName;
  /**
   * The backend whose location decides `data_class` — pick the binding that says
   * whether this process handles real customer content. Absent (or returning
   * undefined) resolves to 'remote', the strictest classification.
   */
  dataClassUrl?: (env: E) => string | undefined;
  /**
   * Worker-specific context fields to add to the redaction allow-list. Only names
   * that can never carry customer content belong here — the shared defaults live in
   * redact.ts ALLOWED_FIELDS.
   */
  allowFields?: readonly string[];
}

export interface WorkerTelemetry<E extends WorkerTelemetryEnv> {
  /**
   * The logger for this isolate, built on first call — call it at every entry point
   * (`fetch`, `queue`, `scheduled`, DO `fetch`/`alarm`) before any `getLogger()`.
   *
   * Deliberately not per request: `P1Logger.create` mints a `run_id` defined as "per
   * process launch", and rebuilding it per request both makes that field meaningless
   * and rewrites the module singleton `getLogger()` reads while other requests are in
   * flight.
   */
  ensureLogger(env: E): P1Logger;
  /** Test seam: drops the memoized logger so a test can build a differently-configured one. */
  resetLoggerForTests(): void;
}

/** `ENVIRONMENT` is a bare string in worker Envs; anything unrecognized is treated as production. */
function toEnvLane(value: string | undefined): 'local' | 'staging' | 'production' {
  return value === 'local' || value === 'staging' ? value : 'production';
}

function toLevel(value: string | undefined): Level | undefined {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : undefined;
}

function buildSinks(env: WorkerTelemetryEnv): Sink[] {
  const lane = toEnvLane(env.ENVIRONMENT);
  const sinks: Sink[] = [createConsoleSink({ format: lane === 'local' ? 'pretty' : 'json' })];

  // `P1_LOG_SINK` lives in top-level wrangler `vars`, which named environments
  // *replace* rather than inherit, so this branch is structurally unreachable in
  // staging and production rather than merely unset there.
  if (env.P1_LOG_SINK !== undefined && env.P1_LOG_SINK !== '') {
    sinks.push(createHttpSink({ url: env.P1_LOG_SINK }));
  }

  return sinks;
}

export function createWorkerTelemetry<E extends WorkerTelemetryEnv>(
  options: WorkerTelemetryOptions<E>,
): WorkerTelemetry<E> {
  let logger: P1Logger | undefined;

  return {
    ensureLogger(env: E): P1Logger {
      logger ??= initLogger({
        app: options.app,
        env: toEnvLane(env.ENVIRONMENT),
        version: env.APP_VERSION ?? 'dev',
        runtime: 'worker',
        minLevel: toLevel(env.LOG_LEVEL),
        dataClass: resolveDataClass(options.dataClassUrl?.(env)),
        sinks: buildSinks(env),
        allowFields: options.allowFields,
      });
      return logger;
    },

    resetLoggerForTests(): void {
      logger = undefined;
    },
  };
}
