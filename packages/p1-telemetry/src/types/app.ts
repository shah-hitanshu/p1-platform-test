/**
 * Which service emitted the line. Add a member when a new worker or app adopts the logger.
 *
 * `unknown` is the fallback for a process that never called `initLogger`. It exists so
 * that omission reads as omission: defaulting to a real service silently files one
 * worker's lines under another's name, which is worse than an unattributed line.
 */
export type AppName = 'css' | 'agent' | 'media' | 'mcp' | 'starter' | 'unknown';

export type EnvLane = 'local' | 'staging' | 'production';

export type Runtime = 'worker' | 'node' | 'browser';

/**
 * Whether the data flowing through this process could be real customer content.
 * Derived from the backend host rather than the env lane: a local process pointed at
 * staging or production handles customer content while `env` still says 'local'.
 */
export type DataClass = 'local' | 'remote';
