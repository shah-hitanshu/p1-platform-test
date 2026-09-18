/**
 * Inbound route CCR calls when a comment mentions an agent. The reply is
 * produced after the request is acknowledged, so CCR never waits on the model.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { McpApiClient } from '../ccr/api-client.js';
import type { Comment, ThreadResponse } from '../ccr/thread-types.js';
import type { Env } from '../env.js';
import { modelSettings } from '../providers/model-settings.js';
import { createTransport, type ModelTransport } from '../providers/transport.js';

export const COMMENT_NOTIFICATION_PATH = '/notifications/comment';
const SECRET_HEADER = 'X-Internal-Secret';
const DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.7-code';
const MAX_REPLY_TOKENS = 600;
const MENTION_TOKEN = /\$\{mention\|(user|agent):([0-9a-f-]{36})\}/gi;

/** The teammate who posted the mention. The agent reads and replies on their behalf. */
export interface MentionRequester {
  id: string;
  email: string;
  name?: string;
}

export interface CommentMentionNotification {
  siteId: string;
  threadId: string;
  commentId: string;
  agentIds: string[];
  requestedBy?: MentionRequester;
}

/** Seams for tests: the CCR client and the model are both injectable. */
export interface MentionCommentDeps {
  createCcrClient?: (env: Env, requestedBy?: MentionRequester) => Pick<McpApiClient, 'getThread' | 'postThreadComment'>;
  createModel?: (env: Env, model: string) => Pick<ModelTransport, 'complete'>;
}

export const REPLY_SYSTEM_PROMPT = `You are an AI collaborator on a website page editor. A teammate mentioned you in a comment thread that is pinned to a section of a page.
Reply as a short comment in the same thread: plain text, no headings or markdown, at most 120 words.
Answer the question or request directly. If you are asked to change page content, describe the change you would make; you cannot edit the page from a comment yet, so do not claim to have changed anything.
Names shown as @Name are teammates in the thread. Do not open with a greeting or the teammate's name; the reply is already addressed to them.`;

export async function handleCommentNotification(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: MentionCommentDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = env.AGENT_NOTIFY_SECRET;
  if (secret === undefined || secret === '' || request.headers.get(SECRET_HEADER) !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const notification = await readNotification(request);
  if (notification === null) return new Response('Invalid notification', { status: 400 });

  if (!notification.agentIds.includes(env.AGENT_ID)) {
    return Response.json({ accepted: false, reason: 'not_addressed' }, { status: 202 });
  }

  ctx.waitUntil(replyToMention(notification, env, deps));
  return Response.json({ accepted: true }, { status: 202 });
}

async function readNotification(request: Request): Promise<CommentMentionNotification | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { siteId, threadId, commentId, agentIds, requestedBy } = body as Record<string, unknown>;
  if (typeof siteId !== 'string' || typeof threadId !== 'string' || typeof commentId !== 'string') return null;
  if (!Array.isArray(agentIds) || !agentIds.every((id) => typeof id === 'string')) return null;
  const notification: CommentMentionNotification = { siteId, threadId, commentId, agentIds };
  if (requestedBy !== undefined) {
    const requester = readRequester(requestedBy);
    if (requester === null) return null;
    notification.requestedBy = requester;
  }
  return notification;
}

function readRequester(value: unknown): MentionRequester | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, email, name } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof email !== 'string') return null;
  return typeof name === 'string' ? { id, email, name } : { id, email };
}

export async function replyToMention(
  notification: CommentMentionNotification,
  env: Env,
  deps: MentionCommentDeps = {},
): Promise<void> {
  const logger = getLogger();
  const fields = { site_id: notification.siteId, thread_id: notification.threadId, comment_id: notification.commentId };
  try {
    const ccr = (deps.createCcrClient ?? defaultCcrClient)(env, notification.requestedBy);
    const thread = await ccr.getThread(notification.siteId, notification.threadId);

    const trigger = thread.comments.find((c) => c.id === notification.commentId);
    if (trigger === undefined) {
      logger.warn('mention reply skipped: comment not in thread', fields);
      return;
    }
    if (alreadyReplied(thread.comments, trigger, env.AGENT_ID)) {
      logger.info('mention reply skipped: already replied', fields);
      return;
    }

    const model = env.AGENT_MODEL || DEFAULT_MODEL;
    const transport = (deps.createModel ?? defaultModel)(env, model);
    const completion = await transport.complete({
      system: REPLY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: renderThread(thread, trigger) }],
      maxTokens: MAX_REPLY_TOKENS,
      temperature: modelSettings(model).temperature,
    });

    const text = completion.content.trim();
    if (text === '') {
      logger.warn('mention reply skipped: model produced no text', fields);
      return;
    }

    await ccr.postThreadComment(notification.siteId, notification.threadId, addressComment(text, trigger));
    logger.info('mention reply posted', fields);
  } catch (error) {
    logger.error('mention reply failed', error instanceof Error ? error : new Error(String(error)), fields);
  }
}

/** True when this agent has already answered anything at or after the triggering comment. */
export function alreadyReplied(comments: Comment[], trigger: Comment, agentId: string): boolean {
  const triggerAt = Date.parse(trigger.createdAt);
  return comments.some(
    (c) => c.author.type === 'agent' && c.author.id === agentId && Date.parse(c.createdAt) >= triggerAt && c.id !== trigger.id,
  );
}

export function renderThread(thread: ThreadResponse, trigger: Comment): string {
  const lines = thread.comments.map((c) => `${displayName(c.author.name, c.author.type)}: ${readableBody(c)}`);
  const where = thread.thread.context.type === 'page'
    ? 'the whole page'
    : `the ${thread.thread.context.type} "${thread.thread.context.id}"`;
  return [
    `Thread pinned to ${where}${thread.thread.status === 'resolved' ? ' (resolved)' : ''}.`,
    '',
    ...lines,
    '',
    `Reply to the latest comment from ${displayName(trigger.author.name, trigger.author.type)}.`,
  ].join('\n');
}

function readableBody(comment: Comment): string {
  return comment.body.replace(MENTION_TOKEN, (_match, _type: string, id: string) => {
    const mention = comment.mentions.find((m) => m.id === id);
    return `@${mention?.name ?? 'someone'}`;
  });
}

function displayName(name: string | null, type: 'user' | 'agent'): string {
  return name ?? (type === 'agent' ? 'An agent' : 'A teammate');
}

/** Mentions the person who asked, so the reply reaches them the same way theirs reached us. */
function addressComment(text: string, trigger: Comment): string {
  if (trigger.author.type !== 'user') return text;
  return `\${mention|user:${trigger.author.id}} ${text}`;
}

function defaultCcrClient(env: Env, requestedBy?: MentionRequester): McpApiClient {
  return new McpApiClient({
    baseUrl: env.CCR_BACKEND_URL,
    agentId: env.AGENT_ID,
    agentApiKey: env.AGENT_API_KEY,
    actingUser: requestedBy,
  });
}

function defaultModel(env: Env, model: string): ModelTransport {
  return createTransport({
    accountId: env.AI_GATEWAY_ACCOUNT_ID,
    gatewayId: env.AI_GATEWAY_NAME,
    apiToken: env.AI_GATEWAY_API_TOKEN,
    model,
    tools: [],
  });
}
