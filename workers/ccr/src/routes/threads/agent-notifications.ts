/**
 * Tells the agent worker when a comment mentions an agent, so it can reply in
 * the thread. Fire-and-forget: the poster's request never waits on it, and a
 * failed delivery is logged and dropped.
 */

import { getLogger, outboundHeaders } from '@pantheon-systems/p1-telemetry';
import { z } from 'zod';
import type { Env } from '../../env';
import type { SiteMembers } from '../../services/site-members-service';
import type { Comment } from '../../types/threads';

export const AGENT_NOTIFICATION_PATH = '/notifications/comment';
export const AGENT_NOTIFICATION_HEADER = 'X-Internal-Secret';
// Bounds only the agent's 202 ack. AGENT_START_MS in packages/puck-css
// (features/threads/pending-agent.ts) has to cover this plus the reply the agent posts after
// it, so raising this without raising that makes the thread give up mid-reply.
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
    getLogger().warn('agent mention not delivered: agent worker not configured', {
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
  const startedAt = Date.now();
  // Called at each outcome rather than once after `fetch`, which resolves on headers:
  // reading the body is part of the delivery and can be most of its duration.
  const timed = (): typeof fields & { duration_ms: number } => ({
    ...fields,
    duration_ms: Date.now() - startedAt,
  });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [AGENT_NOTIFICATION_HEADER]: secret,
        ...outboundHeaders(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      getLogger().warn('agent mention delivery rejected', {
        ...timed(),
        'http.response.status_code': response.status,
      });
      return;
    }
    // A 202 is `ok` whether the agent took the mention or declined it, so the body
    // is the only thing that separates an answered mention from a dropped one.
    const { accepted, reason } = await readAcceptance(response);
    if (accepted === false) {
      getLogger().warn('agent mention declined', { ...timed(), reason: reason ?? 'unspecified', accepted });
      return;
    }
    const outcome = timed();
    getLogger().info('agent mention delivered', accepted === undefined ? outcome : { ...outcome, accepted });
  } catch (error) {
    // `warn` takes no error argument, and a bare `error` field is not on the
    // telemetry allow-list — `error.type` and `reason` are what survive redaction.
    getLogger().warn('agent mention delivery failed', {
      ...timed(),
      'error.type': error instanceof Error ? error.name : typeof error,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

const acceptanceSchema = z.object({
  accepted: z.boolean().optional(),
  reason: z.string().optional(),
});

async function readAcceptance(response: Response): Promise<z.infer<typeof acceptanceSchema>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // A body that isn't JSON is just a mention with no verdict; a read that aborted
    // is a failed delivery, and has to reach the caller's handler to be logged as one.
    if (error instanceof SyntaxError) return {};
    throw error;
  }
  const result = acceptanceSchema.safeParse(body);
  return result.success ? result.data : {};
}
