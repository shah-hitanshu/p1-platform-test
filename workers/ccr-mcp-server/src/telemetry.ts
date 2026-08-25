/**
 * Logger construction for this worker.
 *
 * One answer to "how is the logger configured here". The OAuth provider owns most of the
 * routing, so the outer `fetch` wrapper is the single place this gets called.
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
import type { Env } from './types.js';

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
 */
export function ensureLogger(env: Env): P1Logger {
  logger ??= initLogger({
    app: 'mcp',
    env: toEnvLane(env.ENVIRONMENT),
    version: env.APP_VERSION ?? 'dev',
    runtime: 'worker',
    minLevel: toLevel(env.LOG_LEVEL),
    // `CCR_BACKEND_URL` is the address either transport reaches — the service binding
    // (`CCR_BACKEND`) carries no URL of its own, and both point at the same backend.
    dataClass: resolveDataClass(env.CCR_BACKEND_URL),
    sinks: buildSinks(env),
  });
  return logger;
}

function buildSinks(env: Env): Sink[] {
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
