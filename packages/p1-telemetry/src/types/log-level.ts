export type Level = 'debug' | 'info' | 'warn' | 'error';

/** Numeric weights so a single threshold can gate emission. */
export const LEVEL_WEIGHT: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
