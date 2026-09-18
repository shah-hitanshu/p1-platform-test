/**
 * Tells the agent worker when a comment mentions an agent, so it can reply in
 * the thread. Fire-and-forget: the poster's request never waits on it, and a
 * failed delivery is logged and dropped.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../../env';
import type { SiteMembers } from '../../services/site-members-service';
import type { Comment } from '../../types/threads';

export const AGENT_NOTIFICATION_PATH = '/notifications/comment';
export const AGENT_NOTIFICATION_HEADER = 'X-Internal-Secret';
const DELIVERY_TIMEOUT_MS = 5_000;

/** The person whose comment did the mentioning; the agent acts for them when it answers. */
export interface MentionRequester {
  id: string;
  email: string;
  name: string | null;
}

/** Ids plus the requester; the agent reads the thread back through the API on their behalf. */
export interface CommentMentionNotification {
  siteId: string;
  threadId: string;
  commentId: string;
  agentIds: string[];
  requestedBy?: MentionRequester;
}

/**
 * A global agent's access to a site is bounded by the user it acts for, so the
 * notification names the poster when the roster knows their email.
 */
export function requesterFor(comment: Comment, roster: SiteMembers | null): MentionRequester | undefined {
  if (comment.author.type !== 'user' || roster === null) return undefined;
  const member = roster.members.find((m) => m.id === comment.author.id);
  if (member?.email === null || member === undefined) return undefined;
  return { id: member.id, email: member.email, name: member.name };
}

/** Agents the comment mentions, minus its own author when the author is an agent. */
export function mentionedAgentIds(comment: Comment): string[] {
  const ids = new Set<string>();
  for (const mention of comment.mentions) {
    if (mention.type !== 'agent') continue;
    if (comment.author.type === 'agent' && comment.author.id === mention.id) continue;
    ids.add(mention.id);
  }
  return [...ids];
}

export function notifyMentionedAgents(
  ctx: ExecutionContext | undefined,
  env: Env | undefined,
  siteId: string,
  comment: Comment,
  requestedBy?: MentionRequester,
): void {
  const agentIds = mentionedAgentIds(comment);
  if (agentIds.length === 0) return;

  const target = env?.AGENT_WORKER_URL;
  const secret = env?.AGENT_NOTIFY_SECRET;
  if (target === undefined || target === '' || secret === undefined || secret === '') {
    getLogger().debug('agent mention not delivered: agent worker not configured', {
      site_id: siteId,
      thread_id: comment.threadId,
      comment_id: comment.id,
      agent_count: agentIds.length,
    });
    return;
  }

  const payload: CommentMentionNotification = { siteId, threadId: comment.threadId, commentId: comment.id, agentIds };
  if (requestedBy !== undefined) payload.requestedBy = requestedBy;
  const delivery = deliver(`${target.replace(/\/$/, '')}${AGENT_NOTIFICATION_PATH}`, secret, payload);
  if (ctx === undefined) {
    void delivery;
    return;
  }
  ctx.waitUntil(delivery);
}

async function deliver(url: string, secret: string, payload: CommentMentionNotification): Promise<void> {
  const fields = {
    site_id: payload.siteId,
    thread_id: payload.threadId,
    comment_id: payload.commentId,
    agent_count: payload.agentIds.length,
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [AGENT_NOTIFICATION_HEADER]: secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      getLogger().warn('agent mention delivery rejected', { ...fields, status: response.status });
      return;
    }
    getLogger().info('agent mention delivered', fields);
  } catch (error) {
    getLogger().warn('agent mention delivery failed', { ...fields, error: error instanceof Error ? error.message : String(error) });
  }
}
