import type { Comment, CommentMention } from '@pantheon-systems/css-client';

// Covers the whole round trip, not just CCR's 5s mention delivery timeout: that call waits
// only for the agent's 202, which the agent returns before it reads the thread back, posts its
// reply, and that reply reaches this client over a socket push or a 2.5s poll.
/** How long a mentioned agent has to say it is working before the thread says it did not. */
export const AGENT_START_MS = 10_000;

/**
 * Stands in for each agent the latest comment mentions until that agent speaks for
 * itself. The line reads as working straight away, so the reader who just asked is not
 * left looking at their own comment, and turns into a failure once the agent has had
 * long enough to pick the request up. The moment the agent posts anything, its own row
 * takes the place of the stand-in.
 */
export function withPendingAgents(comments: readonly Comment[], now: number): readonly Comment[] {
  const last = comments[comments.length - 1];
  if (!last || last.author.type !== 'user') return comments;
  const agents = last.mentions.filter((m) => m.type === 'agent');
  if (agents.length === 0) return comments;
  const late = now - Date.parse(last.createdAt) >= AGENT_START_MS;
  return [...comments, ...agents.map((agent) => standIn(last, agent, late))];
}

/** When the stand-ins for the latest comment turn from working to failed, if they will. */
export function pendingAgentDeadline(comments: readonly Comment[], now: number): number | null {
  const last = comments[comments.length - 1];
  if (!last || last.author.type !== 'user' || !last.mentions.some((m) => m.type === 'agent')) return null;
  const deadline = Date.parse(last.createdAt) + AGENT_START_MS;
  return deadline > now ? deadline : null;
}

function standIn(ask: Comment, agent: CommentMention, late: boolean): Comment {
  const name = agent.name ?? 'Agent';
  return {
    id: `pending:${ask.id}:${agent.id}`,
    threadId: ask.threadId,
    kind: 'agent_activity',
    body: late ? `${name} did not respond.` : '',
    metadata: { status: late ? 'failed' : 'working' },
    author: {
      type: 'agent',
      id: agent.id,
      name,
      avatar: null,
      requestedBy: { id: ask.author.id, name: ask.author.name },
    },
    mentions: [],
    createdAt: ask.createdAt,
    editedAt: null,
  };
}
