/** Browser-only package with no `@types/node`, so `process` needs a local declaration. */
declare const process: { env: { NODE_ENV?: string } };

/**
 * Whether this is a development build, for diagnostics that must never reach a real editor.
 * `process.env.NODE_ENV` is written literally because that is the expression bundlers
 * substitute; reading it off `globalThis` defeats that and ships the diagnostic.
 */
export function isDevBuild(): boolean {
  const nodeEnv = typeof process === 'undefined' ? undefined : process.env.NODE_ENV;
  // Unknown is treated as "not dev": losing a diagnostic beats noise in someone's editor.
  return nodeEnv !== undefined && nodeEnv !== 'production';
}
