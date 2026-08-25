/**
 * Logger construction for this worker.
 *
 * Exists so there is exactly one answer to "how is the logger configured here", reachable
 * from both the main worker and the Durable Objects. A DO runs in its own isolate, so
 * without this it would fall through to `getLogger()`'s bare default and stamp its lines
 * `deployment.environment.name: 'local'` in production.
 */

import {
  createConsoleSink,
  initLogger,
  resolveDataClass,
  type Level,
  type P1Logger,
  type Sink,
} from '@pantheon-systems/p1-telemetry';
import { createHttpSink } from '@pantheon-systems/p1-telemetry/sinks/http';

/**
 * Only the bindings the logger reads. Declared structurally rather than as `Env` so the
 * Durable Object env types satisfy it too — they are separate interfaces that happen to
 * receive the same `vars`.
 */
export interface TelemetryEnv {
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
  APP_VERSION?: string;
  /** Local ndjson collector, e.g. `http://127.0.0.1:8799`. Unset in every deployed env. */
  P1_LOG_SINK?: string;
  HYPERDRIVE?: Hyperdrive;
  HYPERDRIVE_NOCACHE?: Hyperdrive;
  POSTGRES_CONNECTION_STRING?: string;
}

/** `ENVIRONMENT` is a bare string in Env; anything unrecognized is treated as production. */
function toEnvLane(value: string | undefined): 'local' | 'staging' | 'production' {
  return value === 'local' || value === 'staging' ? value : 'production';
}

function toLevel(value: string | undefined): Level | undefined {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : undefined;
}

/**
 * The backend this worker talks to, for `data_class`.
 *
 * Read from the bindings rather than from the connection string a given request selected:
 * admin routes use `HYPERDRIVE_NOCACHE` and everything else uses `HYPERDRIVE`, so deriving
 * this per request would make an isolate-lifetime config value depend on which route
 * happened to arrive first.
 *
 * `resolveDataClass` keeps only the resulting 'local' | 'remote' verdict, so the
 * credentials in the connection string are never retained in logger config.
 */
function backendUrl(env: TelemetryEnv): string | undefined {
  return (
    env.HYPERDRIVE?.connectionString ??
    env.HYPERDRIVE_NOCACHE?.connectionString ??
    env.POSTGRES_CONNECTION_STRING
  );
}

let logger: P1Logger | undefined;

/**
 * The logger for this isolate, built on first call.
 *
 * Deliberately not per request. `P1Logger.create` mints a `run_id` and builds the
 * allow-list, and `run_id` is defined as "per process launch" — rebuilding it per request
 * makes the field meaningless and rewrites the module singleton that `getLogger()` reads
 * while other requests are in flight.
 *
 * Call it at every entry point: the main `fetch`, `queue`, `scheduled`, and each DO
 * `fetch`/`alarm`. After the first call it is an `??=` check.
 */
export function ensureLogger(env: TelemetryEnv): P1Logger {
  logger ??= initLogger({
    app: 'css',
    env: toEnvLane(env.ENVIRONMENT),
    version: env.APP_VERSION ?? 'dev',
    runtime: 'worker',
    minLevel: toLevel(env.LOG_LEVEL),
    dataClass: resolveDataClass(backendUrl(env)),
    sinks: buildSinks(env),
    // Version *numbers* (the allowlist's version_id is the row id): which
    // version a content read asked for and which one broke reconstructing it.
    // from_path/to_path: a move's endpoints. doc_path holds one path, and a move
    // report is unreadable without both — no worse than doc_path for content.
    allowFields: [
      'requested_version',
      'broken_version',
      'from_path',
      'to_path',
      // Baseline gate: why a client's Yjs history was refused, and how far apart
      // the two state vectors were. Enum labels and counts only.
      'baseline_source',
      'server_clock_entries',
      'client_clock_entries',
      // Merge job runner [PCC-3737]: the ops story is "find the job from the
      // logs, watch its counters" — these must survive redaction.
      'job_id',
      'job_status',
      'total_documents',
      'conflict_count',
      'chunks_run',
      'published_count',
      'migrated_count',
      'execute_kind',
      'execute_path',
    ],
  });
  return logger;
}

function buildSinks(env: TelemetryEnv): Sink[] {
  const lane = toEnvLane(env.ENVIRONMENT);
  const sinks: Sink[] = [
    createConsoleSink({ format: lane === 'local' ? 'pretty' : 'json' }),
  ];

  // `P1_LOG_SINK` lives in top-level wrangler `vars`, which named environments *replace*
  // rather than inherit, so this branch is structurally unreachable in staging and
  // production rather than merely unset there.
  if (env.P1_LOG_SINK !== undefined && env.P1_LOG_SINK !== '') {
    // No `waitUntil`: the sink only needs one for the early flush that fires above 200
    // buffered lines in a single request, and the correct `ExecutionContext` is
    // per-invocation while this sink is built once per isolate. Holding the first
    // invocation's `ctx` would flush later requests under a stale one. The normal path is
    // `logger.flush()` at the entry point, which is wired.
    sinks.push(createHttpSink({ url: env.P1_LOG_SINK }));
  }

  return sinks;
}

/** Test seam: drops the memoized logger so a test can build a differently-configured one. */
export function resetLoggerForTests(): void {
  logger = undefined;
}
