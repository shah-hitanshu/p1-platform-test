/**
 * Logger construction for this worker, via the shared factory. Call `ensureLogger(env)`
 * at every entry point (`fetch`, `scheduled`) before any `getLogger()` call — an
 * unconfigured `getLogger()` silently falls back to `app: 'unknown'` with no request
 * metadata.
 */

import {
  createWorkerTelemetry,
  type WorkerTelemetryEnv,
} from '@pantheon-systems/p1-telemetry/worker';

export interface TelemetryEnv extends WorkerTelemetryEnv {
  CCR_BASE_URL?: string;
}

const telemetry = createWorkerTelemetry<TelemetryEnv>({
  app: 'media',
  // CCR is what decides whether this process handles real customer content: every
  // authenticated media request validates against it, and a worker pointed at a
  // deployed CCR is serving that deployment's assets.
  dataClassUrl: (env) => env.CCR_BASE_URL,
  // Opaque server-minted ids, safe to log. r2_key/filename stay unlisted — user text.
  allowFields: ['asset_id', 'purge_id'],
});

export const ensureLogger = telemetry.ensureLogger;
export const resetLoggerForTests = telemetry.resetLoggerForTests;
