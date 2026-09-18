/**
 * Pushes a thread change to the editors that have its document open.
 *
 * Sockets hang off the per-document, per-branch session objects, and threads
 * know their document but not a branch, so the site's presence index says which
 * branches to reach. Fire-and-forget: the writer's request never waits on it, and
 * a push that fails is logged and dropped. A thread with no document (a site or
 * workstream thread) has nowhere to go yet.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../../env';
import { toThreadBroadcast, type ThreadEvent } from '../../types/threads';
import type { WsThreadEventMessage } from '../../types/websocket-messages';

interface PresenceLookup {
  getDocumentBranches: (documentId: string) => Promise<string[]>;
}

export function notifyDocumentEditors(
  ctx: ExecutionContext | undefined,
  env: Env | undefined,
  event: ThreadEvent,
): void {
  const documentId = event.thread.documentId;
  if (documentId === null || env === undefined) return;

  const delivery = deliver(env, event, documentId);
  if (ctx === undefined) {
    void delivery;
    return;
  }
  ctx.waitUntil(delivery);
}

async function deliver(env: Env, event: ThreadEvent, documentId: string): Promise<void> {
  const fields = {
    event_type: event.type,
    site_id: event.siteId,
    thread_id: event.thread.id,
    document_id: documentId,
  };
  try {
    const presence = env.PRESENCE.get(env.PRESENCE.idFromName(event.siteId)) as unknown as PresenceLookup;
    const branchIds = await presence.getDocumentBranches(documentId);
    if (branchIds.length === 0) return;

    const message: WsThreadEventMessage = {
      type: 'thread_event',
      event: toThreadBroadcast(event),
      timestamp: Date.now(),
    };
    const body = JSON.stringify(message);

    const results = await Promise.allSettled(
      branchIds.map((branchId) => pushToSession(env, `${event.siteId}:${documentId}:${branchId}`, body)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      getLogger().warn('thread event push failed for some branches', {
        ...fields,
        branch_count: branchIds.length,
        failed_count: failed,
      });
    } else {
      getLogger().debug('thread event pushed', { ...fields, branch_count: branchIds.length });
    }
  } catch (error) {
    getLogger().warn('thread event push failed', {
      ...fields,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function pushToSession(env: Env, sessionId: string, body: string): Promise<void> {
  const stub = env.DOCUMENT_STATE.get(env.DOCUMENT_STATE.idFromName(sessionId));
  const response = await stub.fetch(new Request('http://internal/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
    body,
  }));
  if (!response.ok) {
    throw new Error(`notify rejected with ${String(response.status)}`);
  }
}
