/**
 * ndjson HTTP sink — local development only.
 *
 * Worker code has no filesystem access, so the local ndjson file is written by a
 * collector process (`scripts/log-sink.mjs`) that this sink POSTs to. That indirection
 * is also what unifies the runtimes: the ccr worker, p1-agent, p1-media, the MCP
 * server and the Next server all append to one file, so a single `trace_id` filter
 * reconstructs a whole causal chain.
 *
 * This module is imported only from a dev-only registration path, so it never enters a
 * deployed bundle.
 */

import { bufferFor, currentContext } from '../context.js';
import type { LogLine, Sink } from '../types/index.js';

const SINK_ID = 'ndjson';
const MAX_BUFFERED = 200;
const CIRCUIT_RETRY_MS = 10_000;

/**
 * Counts misuse, not request state, so module scope is right here — it is a property of
 * the process's call sites rather than of any one request. Warned once so a mistake in a
 * hot path cannot itself become the noise.
 */
let unflushedOutsideContext = 0;

export interface HttpSinkOptions {
  /** Collector base URL, e.g. `http://127.0.0.1:8799`. */
  url: string;
  /**
   * Called with an early-flush promise when the buffer fills mid-request. In a Worker
   * this should be `ctx.waitUntil` — a bare floating promise can be frozen with the
   * isolate the moment the response returns.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  fetchImpl?: typeof fetch;
  /** Reports transport failures. Defaults to a one-shot console warning. */
  onError?: (message: string) => void;
}

export function createHttpSink(options: HttpSinkOptions): Sink {
  const doFetch = options.fetchImpl ?? fetch;
  let dropped = 0;
  let circuitOpenUntil = 0;
  let warned = false;

  const warn = (message: string): void => {
    if (options.onError) {
      options.onError(message);
      return;
    }
    // One warning per outage, not one per batch: a log sink that spams the terminal it
    // was meant to declutter is worse than no log sink.
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console -- transport-of-last-resort for the logger itself
      console.warn(`[p1-telemetry] ${message}`);
    }
  };

  async function post(lines: LogLine[]): Promise<void> {
    if (lines.length === 0) return;
    if (Date.now() < circuitOpenUntil) {
      dropped += lines.length;
      return;
    }

    // text/plain keeps this a CORS "simple request" so a browser sink (added later)
    // doesn't pay a preflight round trip per batch.
    const body = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;

    try {
      const response = await doFetch(options.url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body,
      });
      if (!response.ok) {
        throw new Error(`collector returned ${String(response.status)}`);
      }
      if (dropped > 0) {
        const lost = dropped;
        dropped = 0;
        warned = false;
        // eslint-disable-next-line no-console -- reports a hole in the log file itself
        console.warn(`[p1-telemetry] log sink reconnected; ${String(lost)} lines were dropped`);
      }
    } catch (error) {
      dropped += lines.length;
      circuitOpenUntil = Date.now() + CIRCUIT_RETRY_MS;
      warn(
        `log sink unreachable at ${options.url} (${error instanceof Error ? error.message : 'unknown'}); console only`,
      );
    }
  }

  return {
    id: SINK_ID,

    write(line) {
      const context = currentContext();
      if (!context) {
        // No request context means no `waitUntil` to flush under, and no safe place to
        // batch. Console still received the line.
        dropped += 1;
        return;
      }

      const buffer = bufferFor(context, SINK_ID);
      buffer.push(line);

      if (buffer.length >= MAX_BUFFERED) {
        const batch = buffer.splice(0, buffer.length);
        const promise = post(batch);
        if (options.waitUntil) {
          options.waitUntil(promise);
        } else {
          void promise;
        }
      }
    },

    /**
     * Must be called from inside the request's context — buffers are request-scoped, so
     * there is no other way to reach them. `ctx.waitUntil(logger.flush())` is fine
     * because the promise is created inside the scope; `withRequestContext(...).then(()
     * => logger.flush())` is not, and would silently drop the buffer instead of
     * throwing. Warned rather than thrown: telemetry never breaks its own request.
     */
    async flush() {
      const context = currentContext();
      if (!context) {
        if (unflushedOutsideContext === 0) {
          // eslint-disable-next-line no-console -- the logger is what we cannot reach
          console.warn('[p1-telemetry] http sink flush() ran outside a request context');
        }
        unflushedOutsideContext += 1;
        return;
      }
      const buffer = context.buffers.get(SINK_ID);
      if (!buffer || buffer.length === 0) return;
      await post(buffer.splice(0, buffer.length));
    },
  };
}
