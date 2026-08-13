import type { LogLine } from './log-line.js';

/** A destination for log lines. */
export interface Sink {
  /** Stable identifier, used to key per-request buffers. */
  readonly id: string;
  /** Must never throw and never await. */
  write(line: LogLine): void;
  /** Idempotent. A no-op for synchronous sinks. */
  flush(): Promise<void>;
}
