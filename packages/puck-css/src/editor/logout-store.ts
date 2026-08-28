// The plugin hands options to the header through a ref-backed Proxy, which React
// cannot see changing. Logout state goes through this store instead so the header
// re-renders when an attempt starts or fails.

export interface LogoutState {
  /** True while a logout is in flight; disables the menu item. */
  isLoggingOut: boolean;
  /** Set when an attempt failed and the user is still signed in. */
  error: string | null;
}

export interface LogoutStore {
  set(next: LogoutState): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): LogoutState;
}

const IDLE: LogoutState = { isLoggingOut: false, error: null };

export function createLogoutStore(): LogoutStore {
  let snapshot: LogoutState = IDLE;
  const listeners = new Set<() => void>();

  return {
    set(next: LogoutState) {
      // useSyncExternalStore compares snapshots by identity, so an unchanged
      // state has to return the same object rather than an equal one.
      if (next.isLoggingOut === snapshot.isLoggingOut && next.error === snapshot.error) return;
      snapshot = next;
      listeners.forEach((notify) => notify());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): LogoutState {
      return snapshot;
    },
  };
}
