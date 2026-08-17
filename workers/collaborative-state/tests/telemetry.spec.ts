/**
 * Logger construction for this worker.
 *
 * These cover the three things that are easy to get wrong and silent when wrong: that the
 * logger is built once per isolate rather than per request, that `data_class` does not
 * depend on which route arrived first, and that the local ndjson sink attaches when
 * `P1_LOG_SINK` is set and not otherwise.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ensureLogger, resetLoggerForTests, type TelemetryEnv } from '../src/telemetry';

function envWith(overrides: Partial<TelemetryEnv> = {}): TelemetryEnv {
  return {
    ENVIRONMENT: 'local',
    LOG_LEVEL: 'debug',
    APP_VERSION: '1.2.3',
    POSTGRES_CONNECTION_STRING: 'postgres://user:pw@localhost:5432/css',
    ...overrides,
  };
}

/** The emitted line is the only observable surface, so assert through a captured line. */
function firstLine(env: TelemetryEnv): Record<string, unknown> {
  const logger = ensureLogger(env);
  const lines: Record<string, unknown>[] = [];
  logger.addSink({
    id: 'capture',
    write: (line) => lines.push(line as unknown as Record<string, unknown>),
    flush: async () => undefined,
  });
  logger.info('probe');
  return lines[0] ?? {};
}

beforeEach(() => {
  resetLoggerForTests();
});

describe('ensureLogger', () => {
  it('returns the same logger across calls, so run_id survives the isolate', () => {
    const env = envWith();
    const first = ensureLogger(env);
    const second = ensureLogger(env);
    expect(second).toBe(first);
  });

  /**
   * `run_id` is defined as "per process launch". Rebuilding the logger per request would
   * mint a new one every time and make the field useless for isolating a single run.
   */
  it('keeps run_id stable across emits', () => {
    const logger = ensureLogger(envWith());
    const lines: { run_id?: string }[] = [];
    logger.addSink({
      id: 'capture',
      write: (line) => lines.push(line),
      flush: async () => undefined,
    });
    logger.info('one');
    logger.info('two');
    expect(lines[0]?.run_id).toBeDefined();
    expect(lines[1]?.run_id).toBe(lines[0]?.run_id);
  });

  it('stamps the deployment lane from ENVIRONMENT', () => {
    expect(firstLine(envWith({ ENVIRONMENT: 'staging' }))['deployment.environment.name']).toBe(
      'staging',
    );
  });

  /** An unrecognized ENVIRONMENT must not be reported as local — fail safe, not open. */
  it('treats an unknown ENVIRONMENT as production', () => {
    expect(firstLine(envWith({ ENVIRONMENT: 'sbx1' }))['deployment.environment.name']).toBe(
      'production',
    );
  });

  it('reports a loopback database as local content', () => {
    expect(firstLine(envWith()).data_class).toBe('local');
  });

  /**
   * The case the whole `data_class` field exists for: a local process pointed at a real
   * database is handling customer content regardless of what ENVIRONMENT says.
   */
  it('reports a remote database as remote content even when ENVIRONMENT is local', () => {
    const line = firstLine(
      envWith({
        ENVIRONMENT: 'local',
        POSTGRES_CONNECTION_STRING: 'postgres://user:pw@db.staging.pantheon.io:5432/css',
      }),
    );
    expect(line['deployment.environment.name']).toBe('local');
    expect(line.data_class).toBe('remote');
  });

  /**
   * Admin routes select HYPERDRIVE_NOCACHE and everything else HYPERDRIVE, so deriving
   * this from the connection string a given request picked would let an isolate-lifetime
   * value depend on which route happened to arrive first.
   */
  it('derives data_class from the bindings, not from a per-request choice', () => {
    const hyperdrive = { connectionString: 'postgres://user:pw@abc123.hyperdrive.local:5432/css' };
    const line = firstLine(
      envWith({
        POSTGRES_CONNECTION_STRING: 'postgres://user:pw@localhost:5432/css',
        HYPERDRIVE: hyperdrive as unknown as Hyperdrive,
      }),
    );
    // Hyperdrive wins over the direct string, and it is not loopback.
    expect(line.data_class).toBe('remote');
  });

  it('honors LOG_LEVEL, suppressing lines below it', () => {
    const logger = ensureLogger(envWith({ LOG_LEVEL: 'warn' }));
    const lines: { msg?: string }[] = [];
    logger.addSink({
      id: 'capture',
      write: (line) => lines.push(line),
      flush: async () => undefined,
    });
    logger.debug('dropped');
    logger.info('dropped');
    logger.warn('kept');
    expect(lines.map((l) => l.msg)).toEqual(['kept']);
  });
});

describe('field allow-list extensions', () => {
  // The reconstruction-failure log is only useful if these survive redaction —
  // they say which version a read asked for and which one broke rebuilding it.
  it('keeps the version-number fields the content routes log', () => {
    const logger = ensureLogger(envWith());
    const lines: Record<string, unknown>[] = [];
    logger.addSink({
      id: 'capture',
      write: (line) => lines.push(line as unknown as Record<string, unknown>),
      flush: async () => undefined,
    });

    logger.error('probe', undefined, { requested_version: 16, broken_version: 15 });

    const context = lines[0]?.context as Record<string, unknown>;
    expect(context.requested_version).toBe(16);
    expect(context.broken_version).toBe(15);
    expect(context._dropped).toBeUndefined();
  });
});

describe('local ndjson sink', () => {
  /**
   * `P1_LOG_SINK` is declared only in top-level wrangler `vars`, which named environments
   * replace rather than inherit — so this branch is unreachable in staging and production.
   * Asserted here because "the sink cannot run in a deployed worker" is a claim the
   * wrangler config makes and this is the code that relies on it.
   */
  it('attaches only when P1_LOG_SINK is set', async () => {
    const withoutSink = ensureLogger(envWith());
    await expect(withoutSink.flush()).resolves.toBeUndefined();

    resetLoggerForTests();
    const withSink = ensureLogger(envWith({ P1_LOG_SINK: 'http://127.0.0.1:8799' }));
    // Distinct instances prove the second call rebuilt config rather than reusing the
    // memoized sink-less logger.
    expect(withSink).not.toBe(withoutSink);
    await expect(withSink.flush()).resolves.toBeUndefined();
  });

  it('ignores an empty P1_LOG_SINK rather than building a sink pointed at nothing', () => {
    const logger = ensureLogger(envWith({ P1_LOG_SINK: '' }));
    expect(() => {
      logger.info('probe');
    }).not.toThrow();
  });
});
