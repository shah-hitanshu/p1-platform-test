/**
 * Correlation headers.
 *
 * This client runs inside customers' applications, so it deliberately does not collect,
 * buffer, or transmit telemetry anywhere. It only labels its own requests so the backend
 * — which we operate — can correlate them. There is no network egress here beyond the API
 * call the caller already asked for.
 *
 * A minimal W3C trace-context implementation is duplicated here rather than imported from
 * `@pantheon-systems/p1-telemetry`, because that package is private and this one is
 * published with zero runtime dependencies.
 *
 * @see https://www.w3.org/TR/trace-context/
 */

/**
 * Generated from package.json at `prebuild` and on `changeset version`, rather than
 * hand-maintained. These identify the release a customer is running, so a stale value
 * is not cosmetic — it misattributes adoption to the wrong version. The manifest cannot
 * be imported directly: `rootDir` is `./src`, and reaching outside it rewrites the
 * published layout to `dist/src/**`.
 */
export { SDK_NAME, SDK_VERSION } from './sdk-version.js';

export const TELEMETRY_HEADERS = {
  traceparent: 'traceparent',
  requestId: 'x-p1-request-id',
  sdk: 'x-p1-sdk',
  clientId: 'x-p1-client-id',
} as const;

export interface SdkIdentity {
  name: string;
  version: string;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const byte of buf) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * A fresh trace id and span id, with the sampled flag set.
 *
 * The flag means "eligible for sampling", not "definitely record": the backend applies
 * the real rate. Deciding it here would freeze sampling policy into whatever SDK version
 * a customer happens to have installed.
 */
export function newTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export interface CorrelationHeaderOptions {
  sdk: SdkIdentity;
  requestId: string;
  clientId?: string;
  /**
   * Supplies a `traceparent` from an ambient tracer, so a host application already running
   * OpenTelemetry keeps one trace across its own spans and ours. Returning undefined (or
   * omitting this) mints a fresh trace.
   */
  getTraceparent?: () => string | undefined;
}

export function correlationHeaders(options: CorrelationHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    [TELEMETRY_HEADERS.traceparent]: options.getTraceparent?.() ?? newTraceparent(),
    [TELEMETRY_HEADERS.requestId]: options.requestId,
    [TELEMETRY_HEADERS.sdk]: `${options.sdk.name}/${options.sdk.version}`,
  };
  if (options.clientId !== undefined && options.clientId !== '') {
    headers[TELEMETRY_HEADERS.clientId] = options.clientId;
  }
  return headers;
}
