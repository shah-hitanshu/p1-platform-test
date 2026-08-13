/**
 * P1Logger — the only sanctioned way to emit a log line.
 *
 * The instance holds *configuration* (app, env, version, level, sinks) and any fields
 * bound via `child()`. Everything request-scoped is read from AsyncLocalStorage at emit
 * time, never stored on the instance: a Worker isolate serves concurrent requests, so
 * an instance field holding a trace id would cross-contaminate them.
 */

import { currentContext } from './context.js';
import { buildAllowList, redactFields, serializeError } from './redact.js';
import { createConsoleSink, type ConsoleFormat } from './sinks/console.js';
import {
  LEVEL_WEIGHT,
  type AppName,
  type DataClass,
  type EnvLane,
  type Level,
  type LogContext,
  type LogLine,
  type Runtime,
  type Sink,
} from './types/index.js';

export interface LoggerOptions {
  app: AppName;
  env: EnvLane;
  version?: string;
  runtime?: Runtime;
  /** Lines below this level are not built at all. */
  minLevel?: Level;
  /**
   * URL of the backend this process talks to. Used to derive `data_class`; see
   * `resolveDataClass`. Omit only when the process talks to no backend.
   */
  backendUrl?: string;
  /** Overrides the derived `data_class`. Use sparingly — the derivation is safer. */
  dataClass?: DataClass;
  /** Extra allow-listed context field names. Additive; redaction cannot be disabled. */
  allowFields?: readonly string[];
  /** Defaults to a single console sink. */
  sinks?: Sink[];
  consoleFormat?: ConsoleFormat;
}

interface ResolvedConfig {
  app: AppName;
  env: EnvLane;
  version: string;
  runtime: Runtime;
  minWeight: number;
  dataClass: DataClass;
  allowed: ReadonlySet<string>;
  sinks: Sink[];
  runId: string;
}

/**
 * Fail closed: a host we can't confidently identify as loopback is treated as remote,
 * because the consequence of guessing wrong is customer content in a log file. A local
 * process pointed at staging is `env: 'local'` but `data_class: 'remote'`.
 */
export function resolveDataClass(backendUrl: string | undefined): DataClass {
  if (!backendUrl) return 'remote';
  let host: string;
  try {
    host = new URL(backendUrl).hostname.toLowerCase();
  } catch {
    return 'remote';
  }
  const loopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost');
  return loopback ? 'local' : 'remote';
}

function shortId(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Per-process, so a run can be isolated across hot reloads. */
let sequence = 0;

export class P1Logger {
  private constructor(
    private readonly config: ResolvedConfig,
    private readonly bound: LogContext,
  ) {}

  static create(options: LoggerOptions): P1Logger {
    const runtime = options.runtime ?? detectRuntime();
    const config: ResolvedConfig = {
      app: options.app,
      env: options.env,
      version: options.version ?? 'dev',
      runtime,
      minWeight: LEVEL_WEIGHT[options.minLevel ?? (options.env === 'local' ? 'debug' : 'info')],
      dataClass: options.dataClass ?? resolveDataClass(options.backendUrl),
      allowed: buildAllowList(options.allowFields),
      sinks: options.sinks ?? [
        createConsoleSink({ format: options.consoleFormat ?? (options.env === 'local' ? 'pretty' : 'json') }),
      ],
      runId: shortId(),
    };
    return new P1Logger(config, {});
  }

  /** A logger with extra fields pre-bound. Cheap; shares config with its parent. */
  child(fields: LogContext): P1Logger {
    return new P1Logger(this.config, { ...this.bound, ...fields });
  }

  /**
   * Register an additional sink after construction.
   *
   * Sinks are normally passed to `initLogger` so the list is complete before the first
   * emit — dynamic registration silently drops anything logged before a sink attached,
   * and module-import order inside a Worker isolate is not worth depending on. This is
   * the one escape hatch, for a dev-only sink whose module production never imports,
   * which keeps that sink's code out of deployed bundles.
   *
   * Sinks are shared with children created by `child()`.
   */
  addSink(sink: Sink): void {
    this.config.sinks.push(sink);
  }

  /**
   * `fields` may be a thunk so that building an expensive context object is skipped
   * entirely when the level is disabled.
   */
  debug(msg: string, fields?: LogContext | (() => LogContext)): void {
    if (LEVEL_WEIGHT.debug < this.config.minWeight) return;
    this.emit('debug', msg, typeof fields === 'function' ? fields() : fields);
  }

  info(msg: string, fields?: LogContext): void {
    this.emit('info', msg, fields);
  }

  /** Degraded but served — a fail-open path, a retry, a cache miss that mattered. */
  warn(msg: string, fields?: LogContext): void {
    this.emit('warn', msg, fields);
  }

  /** Returns the request id, for echoing into an error response. */
  error(msg: string, err?: unknown, fields?: LogContext): string {
    return this.emit('error', msg, fields, err);
  }

  /**
   * Only from a global error boundary: nothing caught this. Alert on `unhandled=true`
   * rather than on a flag every catch block has to remember to pass correctly.
   */
  unhandled(msg: string, err: unknown, fields?: LogContext): string {
    return this.emit('error', msg, fields, err, true);
  }

  /**
   * Drain async sinks. Call at every entry point — `fetch`, `queue`, `scheduled`, DO
   * `fetch`, DO `alarm` — under `ctx.waitUntil`. A no-op while console is the only sink.
   */
  async flush(): Promise<void> {
    await Promise.all(
      this.config.sinks.map(async (sink) => {
        try {
          await sink.flush();
        } catch {
          // Telemetry never breaks the request that produced it.
        }
      }),
    );
  }

  private emit(
    level: Level,
    msg: string,
    fields?: LogContext,
    err?: unknown,
    unhandled?: true,
  ): string {
    if (LEVEL_WEIGHT[level] < this.config.minWeight) return '';

    const context = currentContext();
    sequence += 1;

    const line: LogLine = {
      ts: Date.now(),
      seq: sequence,
      level,
      msg,
      // Literals, not semconv constants — see the note in `redact.ts`. `semconv.spec`
      // asserts these still match upstream.
      'service.name': this.config.app,
      'service.version': this.config.version,
      'deployment.environment.name': this.config.env,
      runtime: this.config.runtime,
      run_id: this.config.runId,
      data_class: this.config.dataClass,
    };

    if (context) {
      line.trace_id = context.traceId;
      line.span_id = context.spanId;
      if (context.parentSpanId) line.parent_span_id = context.parentSpanId;
      line.request_id = context.requestId;
      if (context.route) line['http.route'] = context.route;
      if (context.sdkName) line.sdk_name = context.sdkName;
      if (context.sdkVersion) line.sdk_version = context.sdkVersion;
      if (context.clientId) line.client_id = context.clientId;
    }

    if (unhandled) line.unhandled = true;
    if (err !== undefined) line.err = serializeError(err);

    const merged =
      Object.keys(this.bound).length === 0 && !fields
        ? undefined
        : { ...this.bound, ...(fields ?? {}) };
    const redacted = redactFields(merged, this.config.allowed);
    if (redacted) line.context = redacted;

    for (const sink of this.config.sinks) {
      try {
        sink.write(line);
      } catch {
        // A broken sink must not take down the request, and must not prevent the
        // other sinks from receiving the line.
      }
    }

    return context?.requestId ?? '';
  }
}

function detectRuntime(): Runtime {
  if (typeof navigator !== 'undefined' && navigator.userAgent?.includes('Cloudflare-Workers')) {
    return 'worker';
  }
  if (typeof window !== 'undefined') return 'browser';
  return 'node';
}

let singleton: P1Logger | undefined;

/**
 * Initialize the process-wide logger. Idempotent per isolate; last call wins.
 *
 * Pass every sink here rather than registering later — the list needs to be complete
 * before the first `emit()`, or early lines go nowhere. See `addSink` for the one
 * exception.
 */
export function initLogger(options: LoggerOptions): P1Logger {
  singleton = P1Logger.create(options);
  return singleton;
}

/**
 * The process-wide logger. Falls back to a bare console logger rather than throwing —
 * a missing `initLogger` should degrade logging, not break the request that was trying
 * to report something.
 *
 * The fallback reports `service.name: 'unknown'`. Naming a real service here would file
 * an uninitialized worker's lines under that service, which is harder to notice than an
 * unattributed line and sends whoever is debugging to the wrong codebase.
 */
export function getLogger(): P1Logger {
  singleton ??= P1Logger.create({ app: 'unknown', env: 'local', minLevel: 'debug' });
  return singleton;
}

/** Test seam. */
export function resetLoggerForTests(): void {
  singleton = undefined;
  sequence = 0;
}
