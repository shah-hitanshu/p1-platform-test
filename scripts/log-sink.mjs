#!/usr/bin/env node
/**
 * Local ndjson log collector. Development only.
 *
 * Worker code has no filesystem access, so every runtime POSTs batches of ndjson here
 * and this process appends them to one file. That's what puts the browser, the Next
 * server, the ccr worker, and p1-agent into a single stream where one `trace_id` filter
 * reconstructs a whole causal chain.
 *
 *   node scripts/log-sink.mjs
 *   jq -c 'select(.trace_id=="…")' .logs/current.ndjson
 *
 * Deliberately dumb: it does not validate the schema, only that each line is JSON.
 */

import { createWriteStream, mkdirSync, renameSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = Number(process.env.P1_LOG_SINK_PORT ?? 8799);
const DIR = process.env.P1_LOG_DIR ?? '.logs';
const CURRENT = join(DIR, 'current.ndjson');
const PREVIOUS = join(DIR, 'previous.ndjson');
const ROTATED = join(DIR, 'current.1.ndjson');
const MAX_BYTES = Number(process.env.P1_LOG_MAX_BYTES ?? 64 * 1024 * 1024);
const MAX_BODY = 4 * 1024 * 1024;

mkdirSync(DIR, { recursive: true });

// The collector owns the file lifecycle, not the logging processes: workers restart
// constantly under `wrangler dev`, and per-process truncation would wipe history on
// every save.
try {
  if (statSync(CURRENT).size > 0) renameSync(CURRENT, PREVIOUS);
} catch {
  // No previous run.
}

let stream = createWriteStream(CURRENT, { flags: 'w' });
let written = 0;
let lines = 0;

function rotate() {
  stream.end();
  renameSync(CURRENT, ROTATED);
  stream = createWriteStream(CURRENT, { flags: 'w' });
  written = 0;
}

function append(payload) {
  const recvTs = Date.now();
  const out = [];

  for (const raw of payload.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;

    // Every line in the file must parse, or a single bad write breaks any jq pipeline
    // reading it. Malformed input is wrapped rather than dropped.
    try {
      const parsed = JSON.parse(line);
      parsed.recv_ts = recvTs;
      out.push(JSON.stringify(parsed));
    } catch {
      out.push(
        JSON.stringify({
          ts: recvTs,
          recv_ts: recvTs,
          level: 'error',
          msg: 'malformed sink line',
          app: 'log-sink',
          raw: line.slice(0, 2000),
        }),
      );
    }
  }

  if (out.length === 0) return null;

  const chunk = `${out.join('\n')}\n`;
  written += Buffer.byteLength(chunk);
  lines += out.length;
  return chunk;
}

/**
 * Write a batch and resolve once it has actually reached the file.
 *
 * `stream.write()` is buffered: it queues the chunk and returns. Responding at that
 * point makes 204 mean "accepted", not "written", so a client that POSTs and then reads
 * the file can legitimately see nothing — a race decided by whether the collector's
 * process gets scheduled before the reader's, which under load it may not. Waiting for
 * the flush callback makes the acknowledgement mean what a collector should promise.
 *
 * One write() per batch: Node serializes writes on a stream, so lines can't interleave.
 * Per-line appendFile would both churn file handles and risk that.
 */
function writeChunk(chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) {
        reject(error);
        return;
      }
      if (written >= MAX_BYTES) rotate();
      resolve();
    });
  });
}

/**
 * Loopback binding keeps other machines out, but not the browser on this one: any page
 * you visit can issue requests to 127.0.0.1. With `*` that meant a hostile page could
 * read the log file's path from the health endpoint and append lines to it. So the
 * allow-list is the local dev origins that have a reason to post here.
 */
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
]);

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  // A non-browser client (the workers, curl) sends no Origin and is unaffected; this
  // only constrains what a page in your browser may do.
  if (origin !== undefined && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'content-type');
  } else if (origin !== undefined) {
    res.writeHead(403).end();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET') {
    // No read endpoint on purpose — reading is `jq` on the file. This only reports health.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, file: CURRENT, lines }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }

  let body = '';
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let chunk;
    try {
      chunk = append(body);
    } catch (error) {
      process.stderr.write(`[log-sink] parse failed: ${String(error)}\n`);
      res.writeHead(500).end();
      return;
    }
    if (chunk === null) {
      res.writeHead(204).end();
      return;
    }
    writeChunk(chunk).then(
      () => res.writeHead(204).end(),
      (error) => {
        process.stderr.write(`[log-sink] write failed: ${String(error)}\n`);
        res.writeHead(500).end();
      },
    );
  });
});

// Loopback only. On 0.0.0.0 anyone on the same network could write into the log file.
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`[log-sink] writing ${CURRENT} (POST http://127.0.0.1:${PORT})\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    process.stdout.write(`\n[log-sink] ${lines} lines written to ${CURRENT}\n`);
    stream.end(() => process.exit(0));
  });
}
