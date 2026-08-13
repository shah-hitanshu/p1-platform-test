import type {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { AppName, DataClass, EnvLane, Runtime } from './app.js';
import type { LogContext } from './log-context.js';
import type { Level } from './log-level.js';

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
  /** `AggregateError.errors`, capped — the only record of what a `Promise.any` lost. */
  errors?: SerializedError[];
}

/**
 * One emitted log record.
 *
 * Naming follows one rule: **use an OpenTelemetry semantic convention wherever one
 * exists, and our own name where none does.** Field names are the one part of this
 * design that's a one-way door — once a Grafana dashboard, saved query, or alert rule
 * references a name, changing it means migrating systems we don't own.
 *
 * The convention keys below are `import type`d from `@opentelemetry/semantic-conventions`,
 * which erases at compile time and costs nothing at runtime — while still making every
 * literal written against this interface (`logger.ts`, `console.ts`) a compile error if
 * it disagrees with upstream.
 *
 * Value-position imports of that package are deliberately avoided: it ships no `import`
 * condition, so wrangler resolves the CJS build, which cannot be tree-shaken — the
 * nineteen names we use cost ~59 KB gzipped in a Worker. `semconv.spec.ts` covers the
 * names this interface does not mention, and pins all of them against a silent upstream
 * rename on `pnpm up`.
 *
 * So: `service.name` / `deployment.environment.name` / `service.version` are OTel
 * *resource* attributes, and `http.route` is an OTel attribute. `trace_id` / `span_id`
 * are OTLP LogRecord fields, not attributes, which is why they stay snake_case. The
 * remainder (`ts`, `seq`, `level`, `msg`, `run_id`, `data_class`, …) has no convention
 * to conform to; those map onto OTLP LogRecord fields at export time.
 *
 * The cost of the dotted keys is `jq` ergonomics — `.["http.route"]` rather than
 * `.route`. Worth it: the destination sees the right names, and the recipes in the
 * README are written for it.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/
 */
export interface LogLine {
  /** Epoch millis. Not a formatted string: cross-runtime string timestamps sort wrong. */
  ts: number;
  /** Per-process monotonic counter, to break same-millisecond ties. */
  seq: number;
  level: Level;
  msg: string;
  /** OTel resource attribute. */
  [ATTR_SERVICE_NAME]: AppName;
  /** OTel resource attribute. */
  [ATTR_SERVICE_VERSION]: string;
  /** OTel resource attribute. */
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: EnvLane;
  runtime: Runtime;
  /** Per process launch, so one run can be isolated across hot reloads. */
  run_id: string;
  data_class: DataClass;
  trace_id?: string;
  span_id?: string;
  /**
   * The caller's span. With it the call tree reconstructs across services; without it
   * these are correlated logs sharing a trace id, which is a weaker claim.
   */
  parent_span_id?: string;
  request_id?: string;
  /** OTel attribute: the low-cardinality route template, e.g. `/api/sites/:id`. */
  [ATTR_HTTP_ROUTE]?: string;
  /** Name half of `x-p1-sdk`, e.g. `p1-next-sdk`. Split so you can group by one and filter the other. */
  sdk_name?: string;
  sdk_version?: string;
  /** Caller-supplied app identifier from `x-p1-client-id`. */
  client_id?: string;
  /** Present only when a global error boundary reported it — nothing caught it. */
  unhandled?: true;
  err?: SerializedError;
  context?: LogContext;
}
