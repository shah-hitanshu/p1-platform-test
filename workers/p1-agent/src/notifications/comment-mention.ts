/**
 * Inbound route CCR calls when a comment mentions an agent. The reply is
 * produced after the request is acknowledged, so CCR never waits on the model.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import { McpApiClient } from '../ccr/api-client.js';
import type { Comment, CommentContent, ProposedOperation, ThreadResponse } from '../ccr/thread-types.js';
import type { Env } from '../env.js';
import { modelSettings } from '../providers/model-settings.js';
import { createTransport, type FnToolCall, type ModelTransport } from '../providers/transport.js';
import type { RawTool } from '../tools/definitions.js';

export const COMMENT_NOTIFICATION_PATH = '/notifications/comment';
const SECRET_HEADER = 'X-Internal-Secret';
const DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.7-code';
const MAX_REPLY_TOKENS = 1500;
const WORKING_LINE = 'Looking into it…';
const FAILED_LINE = 'Something went wrong before I could answer. Mention me again to retry.';
const OUTLINE_TEXT_LIMIT = 80;
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
  createCcrClient?: (env: Env, requestedBy?: MentionRequester) => MentionCcrClient;
  createModel?: (env: Env, model: string, tools: RawTool[]) => Pick<ModelTransport, 'complete'>;
}

export type MentionCcrClient = Pick<McpApiClient, 'getThread' | 'postThreadComment' | 'updateThreadComment'> &
  Partial<Pick<McpApiClient, 'listDocuments' | 'getDocument'>>;

export const PROPOSE_TOOL_NAME = 'propose_document_edits';

/**
 * The one tool the model may call. A call becomes a proposal the teammate can
 * accept or dismiss in the editor; nothing is written to the page from here.
 */
export const PROPOSE_TOOL: RawTool = {
  name: PROPOSE_TOOL_NAME,
  description:
    'Propose edits to the page data. Use this instead of describing a change in prose whenever the request is to change page content. Paths are dot paths into the page data shown to you, e.g. content.2.props.title.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One short sentence on why this change, shown under the affected field on the proposal card. The card already names the block, the field and the text before and after, so do not repeat those.',
      },
      note: { type: 'string', description: 'Optional short comment to the teammate about the proposal.' },
      operations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'replace', 'move'] },
            path: { type: 'string' },
            value: { description: 'New value for add and replace.' },
            from: { type: 'string', description: 'Source path for move.' },
          },
          required: ['op', 'path'],
        },
      },
    },
    required: ['summary', 'operations'],
  },
};

export const REPLY_SYSTEM_PROMPT = `You are an AI collaborator on a website page editor. A teammate mentioned you in a comment thread that is pinned to a section of a page.
When the request is to change page content and the page data is shown to you, call ${PROPOSE_TOOL_NAME} with the smallest set of edits that does the job; the teammate reviews and accepts the proposal in the editor, so do not claim the change has been made. Keep edits inside the pinned section unless asked otherwise.
Otherwise reply as a short comment in the same thread: plain text, no headings or markdown, at most 120 words. Answer the question or request directly.
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

    const placeholder = await ccr.postThreadComment(notification.siteId, notification.threadId, {
      kind: 'agent_activity',
      body: WORKING_LINE,
      metadata: { status: 'working' },
    });
    const finish = (content: CommentContent) =>
      ccr.updateThreadComment(notification.siteId, notification.threadId, placeholder.comment.id, content);

    try {
      const page = await readPage(ccr, thread);
      const model = env.AGENT_MODEL || DEFAULT_MODEL;
      const transport = (deps.createModel ?? defaultModel)(env, model, page ? [PROPOSE_TOOL] : []);
      const completion = await transport.complete({
        system: REPLY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: renderThread(thread, trigger, page) }],
        maxTokens: MAX_REPLY_TOKENS,
        temperature: modelSettings(model).temperature,
      });

      const proposal = readProposal(completion.toolCalls);
      if (proposal !== null) {
        await finish({
          kind: 'agent_proposal',
          body: addressComment(proposal.note ?? proposal.summary, trigger),
          metadata: { status: 'proposed', summary: proposal.summary, operations: proposal.operations },
        });
        logger.info('mention reply posted a proposal', { ...fields, operations: proposal.operations.length });
        return;
      }

      const text = completion.content.trim();
      if (text === '') throw new Error('model produced neither text nor a proposal');
      await finish({ kind: 'message', body: addressComment(text, trigger) });
      logger.info('mention reply posted', fields);
    } catch (error) {
      logger.error('mention reply failed', error instanceof Error ? error : new Error(String(error)), fields);
      await finish({ kind: 'agent_activity', body: FAILED_LINE, metadata: { status: 'failed' } });
    }
  } catch (error) {
    logger.error('mention reply failed', error instanceof Error ? error : new Error(String(error)), fields);
  }
}

/** The page the thread is pinned to, when the thread knows which branch holds it. */
export interface PinnedPage {
  path: string;
  data: Record<string, unknown>;
  /** Dot path of the pinned block inside the page data, when the thread is on a block. */
  blockPath: string | null;
}

async function readPage(ccr: MentionCcrClient, thread: ThreadResponse): Promise<PinnedPage | null> {
  const { branchId, documentId, context } = thread.thread;
  if (!branchId || !documentId || !ccr.listDocuments || !ccr.getDocument) return null;
  const { documents } = await ccr.listDocuments(thread.thread.siteId, branchId);
  const doc = documents.find((d) => d.id === documentId);
  if (doc === undefined) return null;
  const { snapshot } = await ccr.getDocument(thread.thread.siteId, branchId, doc.path);
  return { path: doc.path, data: snapshot, blockPath: context.type === 'block' ? findBlockPath(snapshot, context.id) : null };
}

interface Block {
  type?: string;
  props?: Record<string, unknown>;
}

function blocks(data: Record<string, unknown>): Block[] {
  return Array.isArray(data.content) ? (data.content as Block[]) : [];
}

export function findBlockPath(data: Record<string, unknown>, blockId: string): string | null {
  const index = blocks(data).findIndex((b) => b.props?.id === blockId);
  return index === -1 ? null : `content.${index}`;
}

interface Proposal {
  summary: string;
  note?: string;
  operations: ProposedOperation[];
}

const OPS = new Set(['add', 'remove', 'replace', 'move']);

export function readProposal(toolCalls: FnToolCall[]): Proposal | null {
  const call = toolCalls.find((c) => c.function.name === PROPOSE_TOOL_NAME);
  if (call === undefined) return null;
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return null;
  }
  if (typeof args !== 'object' || args === null) return null;
  const { summary, note, operations } = args as Record<string, unknown>;
  if (typeof summary !== 'string' || summary.trim() === '' || !Array.isArray(operations)) return null;
  const ops = operations.filter(isOperation);
  if (ops.length === 0) return null;
  return { summary: summary.trim(), note: typeof note === 'string' && note.trim() !== '' ? note.trim() : undefined, operations: ops };
}

function isOperation(value: unknown): value is ProposedOperation {
  if (typeof value !== 'object' || value === null) return false;
  const { op, path } = value as Record<string, unknown>;
  return typeof op === 'string' && OPS.has(op) && typeof path === 'string' && path !== '';
}

/** True when this agent has already answered anything at or after the triggering comment. */
export function alreadyReplied(comments: Comment[], trigger: Comment, agentId: string): boolean {
  const triggerAt = Date.parse(trigger.createdAt);
  return comments.some(
    (c) => c.author.type === 'agent' && c.author.id === agentId && Date.parse(c.createdAt) >= triggerAt && c.id !== trigger.id,
  );
}

export function renderThread(thread: ThreadResponse, trigger: Comment, page: PinnedPage | null = null): string {
  const lines = thread.comments
    .filter((c) => c.kind === 'message' || c.kind === 'agent_proposal')
    .map((c) => `${displayName(c.author.name, c.author.type)}: ${readableBody(c)}`);
  const where = thread.thread.context.type === 'page'
    ? 'the whole page'
    : `the ${thread.thread.context.type} "${thread.thread.context.id}"`;
  return [
    `Thread pinned to ${where}${thread.thread.status === 'resolved' ? ' (resolved)' : ''}.`,
    '',
    ...lines,
    '',
    ...(page ? [renderPage(page), ''] : []),
    `Reply to the latest comment from ${displayName(trigger.author.name, trigger.author.type)}.`,
  ].join('\n');
}

function renderPage(page: PinnedPage): string {
  const outline = blocks(page.data).map((b, i) => `content.${i}: ${b.type ?? 'block'} ${outlineText(b)}`.trimEnd());
  const pinned = page.blockPath === null ? null : page.blockPath.split('.').reduce<unknown>(
    (node, key) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined),
    page.data,
  );
  return [
    `Page data for "${page.path}" (top-level blocks, index = position in content):`,
    ...outline,
    ...(pinned === undefined || pinned === null
      ? []
      : ['', `The pinned block at ${page.blockPath}:`, JSON.stringify(pinned, null, 2)]),
  ].join('\n');
}

function outlineText(block: Block): string {
  const props = block.props ?? {};
  const text = ['title', 'heading', 'text', 'label', 'content'].map((k) => props[k]).find((v) => typeof v === 'string');
  if (typeof text !== 'string') return '';
  return `"${text.length > OUTLINE_TEXT_LIMIT ? `${text.slice(0, OUTLINE_TEXT_LIMIT)}…` : text}"`;
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

function defaultModel(env: Env, model: string, tools: RawTool[]): ModelTransport {
  return createTransport({
    accountId: env.AI_GATEWAY_ACCOUNT_ID,
    gatewayId: env.AI_GATEWAY_NAME,
    apiToken: env.AI_GATEWAY_API_TOKEN,
    model,
    tools,
  });
}
