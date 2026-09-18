/**
 * Thread changes pushed from the server, handed from the editor's socket to
 * whoever keeps the thread caches. The socket is owned by the provider, and the
 * caches live below the query provider it renders, so the two meet through a store
 * rather than a prop. Reconnecting is announced too, since anything posted while
 * the socket was down was never pushed.
 */
import type { ThreadEvent } from '@pantheon-systems/css-client';

type EventListener = (event: ThreadEvent) => void;
type ReconnectListener = () => void;

const eventListeners = new Set<EventListener>();
const reconnectListeners = new Set<ReconnectListener>();

export function subscribeToThreadEvents(onEvent: EventListener): () => void {
  eventListeners.add(onEvent);
  return () => {
    eventListeners.delete(onEvent);
  };
}

export function publishThreadEvent(event: ThreadEvent): void {
  eventListeners.forEach((onEvent) => onEvent(event));
}

export function subscribeToThreadsReconnect(onReconnect: ReconnectListener): () => void {
  reconnectListeners.add(onReconnect);
  return () => {
    reconnectListeners.delete(onReconnect);
  };
}

export function publishThreadsReconnect(): void {
  reconnectListeners.forEach((onReconnect) => onReconnect());
}
