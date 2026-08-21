/**
 * Wraps a failed API call in an Error whose message names the request and the
 * HTTP status, so a boot failure is diagnosable from the editor's error screen
 * without opening devtools.
 */
export function describeRequestFailure(request: string, error: unknown): Error {
  const status = (error as { status?: unknown } | null)?.status;
  const statusPart = typeof status === 'number' ? ` (${status})` : '';
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${request} failed${statusPart}: ${detail}`);
}
