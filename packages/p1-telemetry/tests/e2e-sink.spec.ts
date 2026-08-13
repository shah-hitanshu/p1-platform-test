/**
 * Exercises the real HTTP sink against the real collector script, over a real socket.
 * The interesting failure modes here (buffering tied to the request context, a
 * collector that isn't running, malformed lines) are all integration-shaped.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextFromRequest, withRequestContext } from '../src/context.js';
import { P1Logger } from '../src/logger.js';
import { createHttpSink } from '../src/sinks/http.js';
import type { LogLine } from '../src/types/index.js';

const PORT = 8811; // not 8799: keep the test off the port a dev collector would hold
const URL = `http://127.0.0.1:${String(PORT)}`;
const SCRIPT = new globalThis.URL('../../../scripts/log-sink.mjs', import.meta.url).pathname;

let collector: ChildProcess;
let logDir: string;

async function waitForCollector(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(URL);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('collector did not start');
}

function readLines(): LogLine[] {
  const raw = readFileSync(join(logDir, 'current.ndjson'), 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogLine);
}

/**
 * Read back a line the collector was just asked to write, without assuming it is there
 * the instant the POST resolves.
 *
 * The collector is a separate process, so "the request completed" and "the bytes are
 * readable from this process" are different events. Asserting on the first and hoping
 * for the second made this suite depend on which process the scheduler ran next: green
 * on a developer's machine, intermittently red on a loaded CI runner. Polling removes
 * the assumption rather than betting on a margin.
 */
async function lineWhere(
  predicate: (line: LogLine) => boolean,
  timeoutMs = 2000,
): Promise<LogLine | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = readLines().find(predicate);
    if (found || Date.now() > deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  logDir = mkdtempSync(join(tmpdir(), 'p1-logs-'));
  collector = spawn(process.execPath, [SCRIPT], {
    env: { ...process.env, P1_LOG_SINK_PORT: String(PORT), P1_LOG_DIR: logDir },
    stdio: 'ignore',
  });
  await waitForCollector();
});

afterAll(() => {
  collector.kill('SIGTERM');
});

describe('ndjson sink end to end', () => {
  it('writes one parseable line per log call, stamped by the collector', async () => {
    const logger = P1Logger.create({
      app: 'css',
      env: 'local',
      version: '9.9.9',
      runtime: 'worker',
      sinks: [createHttpSink({ url: URL })],
    });

    const context = contextFromRequest(
      new Request('https://example.com/api/sites/abc', {
        headers: { 'x-p1-request-id': 'req-e2e-1' },
      }),
      { route: '/api/sites/:id' },
    );

    await withRequestContext(context, async () => {
      logger.info('request start', { 'http.request.method': 'GET' });
      logger.child({ site_id: 'site-9' }).warn('degraded', { duration_ms: 12 });
      logger.error('exploded', new Error('boom'));
      await logger.flush();
    });

    await lineWhere((l) => l.msg === 'exploded');

    const lines = readLines();
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.msg)).toEqual(['request start', 'degraded', 'exploded']);

    for (const line of lines) {
      expect(line.request_id).toBe('req-e2e-1');
      expect(line['http.route']).toBe('/api/sites/:id');
      expect(line.trace_id).toBe(context.traceId);
      // Stamped server-side, so ordering survives clock skew between processes.
      expect(typeof (line as LogLine & { recv_ts: number }).recv_ts).toBe('number');
    }

    expect(lines[1]?.context).toEqual({ site_id: 'site-9', duration_ms: 12 });
    expect(lines[2]?.err?.message).toBe('boom');
  });

  it('reconstructs one trace across two processes', async () => {
    const makeLogger = (app: 'css' | 'agent') =>
      P1Logger.create({
        app,
        env: 'local',
        runtime: 'worker',
        sinks: [createHttpSink({ url: URL })],
      });

    // The agent receives a request, then calls css forwarding the same trace.
    const inbound = contextFromRequest(new Request('https://agent.example/chat'));
    await withRequestContext(inbound, async () => {
      const agent = makeLogger('agent');
      agent.info('turn start', { model: 'claude-opus-5' });
      await agent.flush();
    });

    const downstream = contextFromRequest(
      new Request('https://css.example/api/sites/abc', {
        headers: {
          traceparent: `00-${inbound.traceId}-00f067aa0ba902b7-01`,
          'x-p1-request-id': inbound.requestId,
        },
      }),
    );
    await withRequestContext(downstream, async () => {
      const css = makeLogger('css');
      css.info('query', { 'db.operation.name': 'select', duration_ms: 3 });
      await css.flush();
    });

    await lineWhere((l) => l.trace_id === inbound.traceId && l['service.name'] === 'css');

    const chain = readLines().filter((l) => l.trace_id === inbound.traceId);
    expect(chain.map((l) => l['service.name'])).toEqual(['agent', 'css']);
    // Same trace, distinct spans — that's what makes the chain a tree rather than a list.
    expect(new Set(chain.map((l) => l.span_id)).size).toBe(2);
  });

  it('keeps the file parseable when a line is malformed', async () => {
    await fetch(URL, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'not json\n' });
    // `readLines` would throw if the collector had written raw garbage.
    const bad = await lineWhere((l) => l.msg === 'malformed sink line');
    expect(bad?.level).toBe('error');
  });

  it('degrades to console when the collector is unreachable', async () => {
    const warnings: string[] = [];
    const logger = P1Logger.create({
      app: 'css',
      env: 'local',
      runtime: 'worker',
      sinks: [
        createHttpSink({ url: 'http://127.0.0.1:9', onError: (m) => warnings.push(m) }),
      ],
    });

    const context = contextFromRequest(new Request('https://example.com/'));
    await withRequestContext(context, async () => {
      logger.info('into the void');
      await expect(logger.flush()).resolves.toBeUndefined();
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('log sink unreachable');
  });

  it('drops rather than buffering module-scope lines with no request context', async () => {
    const logger = P1Logger.create({
      app: 'css',
      env: 'local',
      runtime: 'worker',
      sinks: [createHttpSink({ url: URL })],
    });
    const before = readLines().length;
    logger.info('no context here');
    await logger.flush();
    // A module-level buffer is the concurrency bug this package exists to avoid, so a
    // line with nowhere safe to batch is deliberately not written to the file sink.
    expect(readLines().length).toBe(before);
  });
});
