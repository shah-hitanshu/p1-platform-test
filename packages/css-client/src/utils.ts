import { MissingParameterError } from './errors.js';

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      },
      { once: true },
    );
  });
}

export function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Fail before a request is built when a value bound for a URL path segment is missing.
 *
 * @param params - parameter name → value, named as the caller's argument so the error
 *   tells a developer which argument to fix.
 * @param context - the operation being attempted, e.g. `templates.list`.
 */
export function requirePathParams(
  params: Record<string, string | null | undefined>,
  context: string,
): void {
  for (const [name, value] of Object.entries(params)) {
    // `null` is a live shape on this SDK's surface (`templateId?: string | null`,
    // `getSharedBranchId(): string | null`), and testing only for `undefined` would let
    // it through to `.trim()` — a TypeError naming nothing, which is the opposite of
    // this helper's job.
    if (typeof value !== 'string' || value.trim() === '') {
      throw new MissingParameterError(name, context);
    }
  }
}
