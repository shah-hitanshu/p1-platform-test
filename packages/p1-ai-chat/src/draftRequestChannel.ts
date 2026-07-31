import type { DraftRequest, DraftRequestChannel } from './types.js';

/** How long `getLatest` will still hand back an unconsumed request. See `getLatest`. */
const RETAINED_REQUEST_TTL_MS = 120_000;

/**
 * Default {@link DraftRequestChannel} implementation: a minimal last-value pub/sub.
 * `subscribe` fires on future publishes only; `getLatest` covers publish-before-subscribe.
 */
export function createDraftRequestChannel(): DraftRequestChannel {
  const listeners = new Set<(request: DraftRequest) => void>();
  let latest: DraftRequest | null = null;
  let latestAt = 0;

  return {
    publish(request: DraftRequest): void {
      latest = request;
      latestAt = Date.now();
      for (const listener of [...listeners]) {
        try {
          listener(request);
        } catch {
          // A misbehaving listener must not break delivery to the others.
        }
      }
    },
    subscribe(listener: (request: DraftRequest) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLatest(): DraftRequest | null {
      // `clearLatest` only runs on a successful consume, so a request whose navigation failed
      // would otherwise sit here and auto-submit next time the user opened that document.
      if (latest && Date.now() - latestAt > RETAINED_REQUEST_TTL_MS) latest = null;
      return latest;
    },
    clearLatest(): void {
      latest = null;
    },
  };
}
