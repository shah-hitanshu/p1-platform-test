/**
 * The seam between a committed thread write and whoever wants to hear
 * about it.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../../env';
import type { ThreadEvent } from '../../types/threads';
import { notifyMentionedAgents } from './agent-notifications';
import { notifyDocumentEditors } from './realtime-fanout';

export function emitThreadEvent(
  ctx: ExecutionContext | undefined,
  env: Env | undefined,
  event: ThreadEvent,
): void {
  getLogger().debug('thread event', {
    event_type: event.type,
    site_id: event.siteId,
    thread_id: event.thread.id,
    comment_id: event.type === 'thread_status_changed' ? undefined : event.comment.id,
    context_type: event.thread.context.type,
  });

  notifyDocumentEditors(ctx, env, event);

  if (event.type === 'comment_posted') {
    notifyMentionedAgents(ctx, env, event.siteId, event.comment, event.requester);
  }
}
