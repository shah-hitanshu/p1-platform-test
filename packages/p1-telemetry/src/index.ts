/**
 * @pantheon-systems/p1-telemetry
 *
 * Internal, unpublished. Structured logging, request context, and W3C trace context for
 * the workers.
 *
 * Trace propagation, the context store, and attribute naming come from OpenTelemetry
 * (`api`, `core`, `context-async-hooks`, `semantic-conventions`). The log pipeline —
 * levels, redaction, sinks — is ours: the JS Logs SDK is still "Development" status,
 * and deployed workers egress via `console` + a tail consumer rather than an in-process
 * exporter. No tracer provider is registered here.
 *
 * Published SDK packages do not use this — a library that writes to a customer's stdout
 * is rude, and one that egresses telemetry fails a security review. They take an
 * optional caller-supplied sink instead.
 */

export {
  bufferFor,
  contextForTask,
  contextFromRequest,
  currentContext,
  installContextManager,
  outboundHeaders,
  taskTraceFields,
  withRequestContext,
  P1_TELEMETRY_HEADERS,
  type ContextForTaskOptions,
  type ContextFromRequestOptions,
  type RequestContext,
} from './context.js';

export {
  isValidTraceId,
  newSpanId,
  newTraceId,
  normalizeSpanId,
  normalizeTraceId,
  traceContextPropagator,
} from './trace-context.js';

export { ALLOWED_FIELDS, buildAllowList, redactFields, serializeError } from './redact.js';

export { createConsoleSink, type ConsoleFormat } from './sinks/console.js';

export {
  getLogger,
  initLogger,
  P1Logger,
  resetLoggerForTests,
  resolveDataClass,
  type LoggerOptions,
} from './logger.js';

export {
  LEVEL_WEIGHT,
  type AppName,
  type DataClass,
  type EnvLane,
  type Level,
  type LogContext,
  type LogLine,
  type Runtime,
  type SerializedError,
  type Sink,
} from './types/index.js';
