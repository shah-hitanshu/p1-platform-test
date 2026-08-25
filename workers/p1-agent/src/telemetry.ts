/**
 * Logger construction for this worker.
 *
 * Reachable from both the main worker and the ChatAgent Durable Object. A DO runs in its
 * own isolate, so without a call here it would fall through to `getLogger()`'s bare
 * default and stamp its lines `deployment.environment.name: 'local'` in production —
 * which is where nearly all of this worker's interesting logging happens.
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
 * Durable Object's env satisfies it too without importing the full worker Env.
 */
export interface TelemetryEnv {
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
  APP_VERSION?: string;
  /** Local ndjson collector, e.g. `http://127.0.0.1:8799`. Unset in every deployed env. */
  P1_LOG_SINK?: string;
  CCR_BACKEND_URL?: string;
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

let logger: P1Logger | undefined;

/**
 * The logger for this isolate, built on first call.
 *
 * Deliberately not per request: `P1Logger.create` mints a `run_id` defined as "per process
 * launch", and rebuilding it per request both makes that field meaningless and rewrites the
 * module singleton `getLogger()` reads while other requests are in flight.
 *
 * Call it at every entry point — the main `fetch` and the DO constructor. After the first
 * call it is an `??=` check.
 */
export function ensureLogger(env: TelemetryEnv): P1Logger {
  logger ??= initLogger({
    app: 'agent',
    env: toEnvLane(env.ENVIRONMENT),
    version: env.APP_VERSION ?? 'dev',
    runtime: 'worker',
    minLevel: toLevel(env.LOG_LEVEL),
    // Model calls go to the AI Gateway, but CCR is where customer content comes from —
    // it is what decides whether this process is handling real content.
    dataClass: resolveDataClass(env.CCR_BACKEND_URL),
    sinks: buildSinks(env),
  });
  return logger;
}

function buildSinks(env: TelemetryEnv): Sink[] {
  const lane = toEnvLane(env.ENVIRONMENT);
  const sinks: Sink[] = [createConsoleSink({ format: lane === 'local' ? 'pretty' : 'json' })];

  // `P1_LOG_SINK` lives in top-level wrangler `vars`, which named environments *replace*
  // rather than inherit, so this branch is structurally unreachable in staging and
  // production rather than merely unset there.
  if (env.P1_LOG_SINK !== undefined && env.P1_LOG_SINK !== '') {
    sinks.push(createHttpSink({ url: env.P1_LOG_SINK }));
  }

  return sinks;
}
