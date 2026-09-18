/**
 * Which thread is open, for the whole editor.
 *
 * Triggers are mounted and unmounted independently — each block's is drawn in its own
 * overlay — so there is nowhere between two of them to hold "only one thread at a time"
 * except outside them both.
 */
const listeners = new Set<() => void>();

let openThreadKey: string | null = null;

export function threadKey(contextType: string, contextId: string): string {
  return `${contextType}:${contextId}`;
}

export function subscribeToOpenThread(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getOpenThread(): string | null {
  return openThreadKey;
}

export function setOpenThread(key: string | null): void {
  if (key === openThreadKey) return;
  openThreadKey = key;
  listeners.forEach((onChange) => onChange());
}
