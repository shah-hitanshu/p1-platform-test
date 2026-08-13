/**
 * Caller-supplied fields attached to a log line. Passed through the allow-list before
 * emission, so an arbitrary object here is safe to hand to the logger.
 */
export type LogContext = Record<string, unknown>;
