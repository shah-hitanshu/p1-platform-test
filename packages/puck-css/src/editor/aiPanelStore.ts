import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  // Copied: notifying a listener can unsubscribe it.
  for (const listener of [...listeners]) listener();
}

/**
 * Whether the AI chat panel occupies the right-hand inspector rail. A module singleton because
 * the toggle and the panel are sibling Puck overrides, and the `header` override has no
 * `dispatch` to reach Puck's own `ui` state.
 */
export const aiPanelStore = {
  isOpen: (): boolean => open,
  open: (): void => {
    if (open) return;
    open = true;
    emit();
  },
  close: (): void => {
    if (!open) return;
    open = false;
    emit();
  },
  toggle: (): void => {
    open = !open;
    emit();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Subscribe to {@link aiPanelStore}. Always closed on the server. */
export function useAIPanelOpen(): boolean {
  return useSyncExternalStore(aiPanelStore.subscribe, aiPanelStore.isOpen, () => false);
}
