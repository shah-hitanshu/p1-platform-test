/**
 * The seam between a committed thread write and whoever wants to hear
 * about it.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../../env';
import type { ThreadEvent } from '../../types/threads';

export function emitThreadEvent(
  _ctx: ExecutionContext | undefined,
  _env: Env | undefined,
  event: ThreadEvent,
): void {
  getLogger().debug('thread event', {
    event_type: event.type,
    site_id: event.siteId,
    thread_id: event.thread.id,
    comment_id: event.type === 'comment_posted' ? event.comment.id : undefined,
    context_type: event.thread.context.type,
  });
}
