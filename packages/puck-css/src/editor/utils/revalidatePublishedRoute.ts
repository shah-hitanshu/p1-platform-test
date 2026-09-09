/**
 * Tell the hosting Next.js app that a published route's content changed.
 *
 * Publishing goes to the backend directly, so the app serving the public pages
 * never sees the request and cannot know one of its cached renders is now out of
 * date. That includes the "no such page" render cached at a path whose page did
 * not exist yet: without this call, publishing that page leaves the cached 404
 * in place for the app's whole revalidate window.
 *
 * The endpoint is the SDK's `revalidate` action, mounted at the same
 * `/p1/api` base as the other handler actions this package calls.
 */

const REVALIDATE_ENDPOINT = '/p1/api/revalidate';

/**
 * Deadline for the whole call — obtaining a token and the request itself.
 *
 * The publish flow waits on this, and neither `getToken()` nor `fetch()` has a
 * timeout of its own: a stalled connection settles neither, so an unbounded
 * await would hold up everything the caller does after a publish rather than
 * failing. A few seconds is long enough for a request that is merely slow.
 */
const REVALIDATE_TIMEOUT_MS = 5_000;

/** Rejects when `signal` aborts, so a promise with no timeout of its own gains one. */
function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new Error('revalidate timed out')),
        { once: true },
      );
    }),
  ]);
}

/**
 * Returns whether the route was invalidated.
 *
 * Never throws and never hangs. The publish it follows has already committed,
 * so a failure here is a stale route, not a failed publish, and must not be
 * reported as one — nor delay the caller past the deadline above.
 */
export async function revalidatePublishedRoute(
  path: string,
  getToken: () => Promise<string | null>,
): Promise<boolean> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS);

  try {
    const token = await withDeadline(getToken(), controller.signal);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(REVALIDATE_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path }),
      // Aborting cancels the request rather than only abandoning the await, so
      // a stalled connection is not left open behind a publish that moved on.
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(deadline);
  }
}
