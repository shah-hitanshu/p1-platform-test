/**
 * Whether threads are on for this reader, for the whole editor.
 *
 * The rollout answer arrives through the overrides, but the loader that primes a
 * page's threads lives in the plugin's panel and the triggers live in the block
 * overlays: three trees with no shared ancestor this package renders. A small store
 * reaches all of them; the overrides set it, everything else reads it.
 */
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

let enabled = false;

export function subscribeToThreadsEnabled(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getThreadsEnabled(): boolean {
  return enabled;
}

export function setThreadsEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  listeners.forEach((onChange) => onChange());
}

export function useThreadsEnabled(): boolean {
  return useSyncExternalStore(
    subscribeToThreadsEnabled,
    getThreadsEnabled,
    getThreadsEnabled,
  );
}
