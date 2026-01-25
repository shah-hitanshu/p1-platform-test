/**
 * Phase 10.2: Metrics Service
 *
 * Lightweight telemetry service for the Collaborative State System.
 * Uses request-scoped buffering with async push to Grafana Cloud.
 *
 * Pattern: Buffer metrics during request, flush on completion (fire-and-forget).
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Labels attached to metrics for grouping/filtering.
 */
export type MetricLabels = Record<string, string>;

/**
 * Configuration for metrics collection and push.
 */
export interface MetricsConfig {
  /** Whether metrics collection is enabled */
  enabled: boolean;
  /** Grafana Cloud push endpoint URL */
  pushEndpoint?: string;
  /** Grafana Cloud API key */
  apiKey?: string;
  /** Environment name (e.g., 'production', 'sbx1') */
  environment: string;
  /** Application version */
  version: string;
}

/**
 * Internal metric point structure for buffering.
 */
export interface MetricPoint {
  /** Metric name (e.g., 'css_http_request_total') */
  name: string;
  /** Metric type */
  type: 'counter' | 'gauge' | 'histogram';
  /** Numeric value */
  value: number;
  /** Optional labels */
  labels?: MetricLabels;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum number of metrics that can be buffered per request.
 * Prevents memory exhaustion from excessive metric creation.
 */
const MAX_METRICS_PER_REQUEST = 1000;

// =============================================================================
// Module-level state (request-scoped in Cloudflare Workers)
// Note: In Cloudflare Workers, each request runs in isolation, so module-level
// state is effectively request-scoped. The buffer is safe to use this way.
// =============================================================================

/** Buffered metrics for current request */
let metricsBuffer: MetricPoint[] = [];

/** Current configuration */
let metricsConfig: MetricsConfig | null = null;

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Initialize metrics for the current request.
 * Should be called at the start of each request.
 *
 * @param config Metrics configuration
 */
export function initializeMetrics(config: MetricsConfig): void {
  metricsConfig = config;
  metricsBuffer = [];
}

/**
 * Increment a counter metric.
 *
 * @param name Metric name (e.g., 'css_http_request_total')
 * @param labels Optional labels for the metric
 * @param value Value to increment by (default: 1)
 */
export function incrementCounter(
  name: string,
  labels?: MetricLabels,
  value = 1,
): void {
  if (metricsConfig?.enabled !== true) {
    return;
  }

  // Prevent memory exhaustion from excessive metrics
  if (metricsBuffer.length >= MAX_METRICS_PER_REQUEST) {
    return;
  }

  metricsBuffer.push({
    name,
    type: 'counter',
    value,
    labels,
    timestamp: Date.now(),
  });
}

/**
 * Record a timing/duration metric.
 *
 * @param name Metric name (e.g., 'css_http_request_duration_ms')
 * @param durationMs Duration in milliseconds
 * @param labels Optional labels for the metric
 */
export function recordTiming(
  name: string,
  durationMs: number,
  labels?: MetricLabels,
): void {
  if (metricsConfig?.enabled !== true) {
    return;
  }

  // Prevent memory exhaustion from excessive metrics
  if (metricsBuffer.length >= MAX_METRICS_PER_REQUEST) {
    return;
  }

  metricsBuffer.push({
    name,
    type: 'histogram',
    value: durationMs,
    labels,
    timestamp: Date.now(),
  });
}

/**
 * Set a gauge metric to a specific value.
 *
 * @param name Metric name (e.g., 'css_ws_connections_active')
 * @param value Current value
 * @param labels Optional labels for the metric
 */
export function setGauge(
  name: string,
  value: number,
  labels?: MetricLabels,
): void {
  if (metricsConfig?.enabled !== true) {
    return;
  }

  // Prevent memory exhaustion from excessive metrics
  if (metricsBuffer.length >= MAX_METRICS_PER_REQUEST) {
    return;
  }

  metricsBuffer.push({
    name,
    type: 'gauge',
    value,
    labels,
    timestamp: Date.now(),
  });
}

/**
 * Flush all buffered metrics to the push endpoint.
 * Should be called at the end of each request (in finally block).
 *
 * Fire-and-forget: Errors are logged but not thrown.
 */
export async function flushMetrics(): Promise<void> {
  // Early exit if disabled or no buffer
  if (metricsConfig?.enabled !== true) {
    return;
  }

  if (metricsBuffer.length === 0) {
    return;
  }

  // No endpoint configured - just clear buffer
  if (metricsConfig.pushEndpoint === undefined || metricsConfig.pushEndpoint === '') {
    metricsBuffer = [];
    return;
  }

  // Capture config values before async operation (they won't change during request)
  const { pushEndpoint, apiKey, environment, version } = metricsConfig;

  // Security: Validate endpoint is HTTPS to prevent API key exposure
  if (!pushEndpoint.startsWith('https://')) {
    console.warn('Metrics push endpoint must be HTTPS');
    metricsBuffer = [];
    return;
  }

  // Security: Validate API key is configured
  if (apiKey === undefined || apiKey === '') {
    console.warn('Cannot push metrics: apiKey is not configured');
    metricsBuffer = [];
    return;
  }

  // Prepare payload with global labels added
  const payload = metricsBuffer.map((metric) => ({
    ...metric,
    labels: {
      ...metric.labels,
      environment,
      version,
    },
  }));

  // Clear buffer before push (prevents memory growth on repeated failures)
  metricsBuffer = [];

  try {
    const response = await fetch(pushEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metrics: payload }),
    });

    if (!response.ok) {
      console.warn(
        `Metrics push failed: ${String(response.status)} ${response.statusText}`,
      );
    }
  } catch (error) {
    // Log and continue - metrics should never break the request
    console.warn(
      'Metrics push error:',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

/**
 * Get the current metrics buffer (for testing).
 */
export function getMetricsBuffer(): MetricPoint[] {
  return metricsBuffer;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * UUID regex pattern for path normalization.
 * Matches standard UUID format: 8-4-4-4-12 hex characters.
 */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Normalize a URL path to reduce cardinality by replacing dynamic segments.
 *
 * Examples:
 * - /api/sites/abc-123-def → /api/sites/:id
 * - /api/sites/abc/branches/def → /api/sites/:id/branches/:id
 * - /health → /health
 *
 * @param path URL path to normalize
 * @returns Normalized path pattern
 */
export function normalizePathPattern(path: string): string {
  // Remove query string if present
  const pathWithoutQuery = path.split('?')[0];

  // Replace UUIDs with :id placeholder
  return pathWithoutQuery.replace(UUID_PATTERN, ':id');
}

/**
 * Classify an error for metrics labeling.
 *
 * @param error The error to classify
 * @returns Error type string for labeling
 */
export function classifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  if (typeof error === 'object' && error !== null && 'name' in error) {
    return String((error as { name: unknown }).name);
  }

  if (typeof error === 'string') {
    return 'StringError';
  }

  return 'UnknownError';
}

/**
 * Get the HTTP status class for a status code.
 *
 * @param status HTTP status code
 * @returns Status class string (e.g., '2xx', '4xx', '5xx')
 */
export function getStatusClass(status: number): string {
  const firstDigit = Math.floor(status / 100);
  return `${String(firstDigit)}xx`;
}
