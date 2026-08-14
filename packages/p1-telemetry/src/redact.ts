/**
 * Context redaction. Allow-list only, and not switchable off in any environment.
 *
 * Allow-list rather than deny-list so an unrecognized field defaults to dropped: the
 * failure mode is a missing dashboard field rather than a leak. Dropped *names* are
 * reported — they're developer-chosen identifiers, not customer data.
 *
 * No off switch, including locally, because a local process can run against a staging
 * or production backend. To inspect a real payload, use a debugger.
 */

import type { LogContext, SerializedError } from './types/index.js';

/**
 * Identifiers, dimensions, and measurements. Nothing that can hold document content,
 * prompts, completions, credentials, or free text a user typed.
 */
const DEFAULT_ALLOWED: readonly string[] = [
  // ---------------------------------------------------------------------------
  // OpenTelemetry semantic conventions. Dotted names are deliberate: these are
  // the names a Grafana dashboard or alert rule will reference, and renaming
  // them later means migrating systems we don't own.
  //
  // Written as literals, not imported from `@opentelemetry/semantic-conventions`.
  // That package ships no `import` condition, so wrangler resolves its CJS build,
  // which cannot be tree-shaken: importing these nineteen strings costs ~59 KB
  // gzipped in a Worker bundle. `semconv.spec.ts` imports the constants instead
  // and asserts these literals still equal them — same protection against a typo
  // or a silent upstream rename, at zero runtime bytes.
  // https://opentelemetry.io/docs/specs/semconv/
  // ---------------------------------------------------------------------------
  'http.request.method', 'http.response.status_code', 'http.route', 'server.address',
  'error.type',
  'db.operation.name', 'db.collection.name', 'db.response.returned_rows',
  'gen_ai.system', 'gen_ai.request.model', 'gen_ai.response.model',
  'gen_ai.response.finish_reasons', 'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens', 'gen_ai.tool.name', 'gen_ai.operation.name',

  // ---------------------------------------------------------------------------
  // P1-specific. No convention exists for these, so there is nothing to be
  // incompatible with; they stay snake_case for `jq` and LogQL readability.
  // ---------------------------------------------------------------------------
  // identity / addressing
  'site_id', 'branch_id', 'document_id', 'doc_path', 'version_id', 'checkpoint_id',
  'template_id', 'session_id', 'principal_id', 'principal_type', 'agent_id', 'slot_id',
  'merge_request_id', 'queue', 'message_id',
  // routing / edge
  'status_class', 'origin', 'cf_ray', 'colo', 'country',
  // outcomes
  'outcome', 'reason', 'error_code', 'rate_limited', 'timed_out', 'aborted', 'attempt',
  'retries', 'handled',
  // measurements. Note: OTel defines request duration as a *metric*
  // (`http.server.request.duration`, in seconds) — there is no log attribute for it,
  // so a millisecond field of our own is the honest choice rather than borrowing a
  // metric name with the wrong unit.
  'duration_ms', 'ttft_ms', 'count', 'size_bytes', 'bytes', 'iteration', 'depth',
  'age_ms', 'lag_ms', 'connections', 'queue_depth',
  // db
  'is_hyperdrive', 'in_transaction',
  // ai / mcp
  'gateway_id', 'tool_calls', 'cache_read_tokens', 'cache_creation_tokens', 'streamed',
  'loop_iteration', 'acting_user_present',
  // sdk
  'sdk_name', 'sdk_version', 'client_id', 'trigger',
  // [claude] redirects — temporary, for diagnosing why staging doesn't redirect.
  // Site-relative URLs of the same kind as the already-allowed `doc_path`, plus the
  // branch the resolver actually read. Remove with the log lines they serve.
  'from_path', 'destination', 'redirect_type', 'parenting', 'redirect_id',
  'lookup_path', 'resolved_via', 'main_branch_id', 'path_prefix',
];

const MAX_STRING = 512;
const MAX_DEPTH = 3;
const MAX_ARRAY = 20;
const MAX_KEYS = 40;

/**
 * Value-level scrubbing applied even to allow-listed fields, because an allow-listed
 * field can still receive a credential by mistake (`reason: 'bad token eyJ…'`).
 */
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[redacted:jwt]'],
  [/\bsk-[A-Za-z0-9-]{16,}\b/g, '[redacted:key]'],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[redacted:auth]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted:email]'],
];

function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  if (out.length > MAX_STRING) {
    out = `${out.slice(0, MAX_STRING)}…[truncated ${out.length - MAX_STRING}]`;
  }
  return out;
}

/**
 * Values are shaped, not just filtered: unbounded nesting or a huge array in a log
 * line is its own kind of incident.
 */
function scrubValue(value: unknown, depth: number, allowed: ReadonlySet<string>): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case 'string':
      return scrubString(value);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return `[${typeof value}]`;
    default:
      break;
  }

  if (depth >= MAX_DEPTH) return '[depth-capped]';

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => scrubValue(item, depth + 1, allowed));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY} more]`);
    return items;
  }

  if (value instanceof Date) return value.toISOString();

  // A nested object's keys are re-checked against the allow-list: nesting is not an
  // escape hatch for logging something the top level wouldn't accept.
  if (typeof value === 'object') {
    return redactFields(value as LogContext, allowed, depth + 1) ?? {};
  }

  return '[unserializable]';
}

/**
 * Apply the allow-list. Returns undefined when nothing survived, so an empty `ctx`
 * key never appears on the line.
 *
 * The allow-list is passed in rather than read from module state: config that is set
 * once at init still shouldn't be mutable module-globals in a Worker isolate.
 */
export function redactFields(
  fields: LogContext | undefined,
  allowed: ReadonlySet<string>,
  depth = 0,
): LogContext | undefined {
  if (!fields) return undefined;

  const out: LogContext = {};
  const dropped: string[] = [];
  let kept = 0;

  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key)) {
      dropped.push(key);
      continue;
    }
    if (kept >= MAX_KEYS) {
      dropped.push(key);
      continue;
    }
    out[key] = scrubValue(value, depth, allowed);
    kept += 1;
  }

  if (dropped.length > 0) {
    // Names only — never values. This is what makes a missing field debuggable
    // without turning the log into the leak it was meant to prevent.
    out._dropped = dropped.slice(0, MAX_KEYS);
  }

  return kept === 0 && dropped.length === 0 ? undefined : out;
}

/**
 * Extend the allow-list at init. Additive only — there is no removal, and no way to
 * disable redaction wholesale.
 */
export function buildAllowList(extra: readonly string[] = []): ReadonlySet<string> {
  return new Set([...DEFAULT_ALLOWED, ...extra]);
}

/** Exported for tests and for documenting the contract. */
export const ALLOWED_FIELDS: readonly string[] = DEFAULT_ALLOWED;

const MAX_STACK = 4096;
const MAX_CAUSE_DEPTH = 3;
/** A failed `Promise.any` over a large list would otherwise put all of it on one line. */
const MAX_AGGREGATE_ERRORS = 5;

/**
 * Normalize a thrown value into a loggable shape.
 *
 * Takes `unknown` because `catch` gives `unknown`, and because the most common
 * mistake — `JSON.stringify(err)` on an SDK error — both drops the message (an
 * `Error`'s own fields are non-enumerable, so it serializes to `{}`) and can dump an
 * attached `request`/`response` object carrying auth headers. Only the four fields
 * below are ever read.
 */
export function serializeError(value: unknown, depth = 0): SerializedError {
  if (value instanceof Error) {
    const out: SerializedError = {
      name: value.name,
      message: scrubString(value.message),
    };
    if (typeof value.stack === 'string') {
      out.stack = value.stack.length > MAX_STACK ? value.stack.slice(0, MAX_STACK) : value.stack;
    }
    if (value.cause !== undefined && value.cause !== null && depth < MAX_CAUSE_DEPTH) {
      out.cause = serializeError(value.cause, depth + 1);
    }
    // An AggregateError's message is a fixed string ("All promises were rejected") and
    // its `errors` array holds the only account of what actually failed. `Promise.any`
    // and several fetch paths throw it, so dropping the array loses the whole diagnosis.
    if (Array.isArray((value as AggregateError).errors) && depth < MAX_CAUSE_DEPTH) {
      out.errors = (value as AggregateError).errors
        .slice(0, MAX_AGGREGATE_ERRORS)
        .map((inner: unknown) => serializeError(inner, depth + 1));
    }
    return out;
  }

  if (typeof value === 'string') {
    return { name: 'NonError', message: scrubString(value) };
  }

  if (typeof value === 'object' && value !== null) {
    const maybe = value as { name?: unknown; message?: unknown };
    return {
      name: typeof maybe.name === 'string' ? maybe.name : 'NonError',
      message: typeof maybe.message === 'string' ? scrubString(maybe.message) : '[object]',
    };
  }

  return { name: 'NonError', message: scrubString(String(value)) };
}
