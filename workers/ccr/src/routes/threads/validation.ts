/**
 * Request schemas for the threads endpoints. Kept apart from the
 * handlers so a router with validation middleware can mount them directly.
 */

import { z } from 'zod';
import {
  ACTIVITY_STATUSES,
  CONTEXT_TYPES,
  DEFAULT_LIST_LIMIT,
  MAX_BODY_LENGTH,
  MAX_CONTEXT_ID_LENGTH,
  MAX_LIST_LIMIT,
  MAX_PROPOSAL_OPERATIONS,
  MAX_PROPOSAL_SUMMARY_LENGTH,
  OPERATION_TYPES,
  THREAD_STATUSES,
  type CommentContent,
} from '../../types/threads';
import { UUID_PATTERN } from '../../utils/uuid';

const commentBody = z
  .string()
  .trim()
  .min(1, 'body must not be empty')
  .max(MAX_BODY_LENGTH, `body must be at most ${String(MAX_BODY_LENGTH)} characters`);

const contextRef = z.object({
  type: z.enum(CONTEXT_TYPES),
  id: z.string().min(1).max(MAX_CONTEXT_ID_LENGTH),
});

/** Block and page threads live on a document; site and workstream threads do not. */
export const postThreadSchema = z
  .object({
    context: contextRef,
    documentId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    body: commentBody,
  })
  .superRefine((value, issues) => {
    const needsDocument = value.context.type === 'block' || value.context.type === 'page';
    if (needsDocument && value.documentId === undefined) {
      issues.addIssue({
        code: 'custom',
        path: ['documentId'],
        message: `documentId is required for a ${value.context.type} thread`,
      });
    }
    if (!needsDocument && value.documentId !== undefined) {
      issues.addIssue({
        code: 'custom',
        path: ['documentId'],
        message: `documentId is not allowed on a ${value.context.type} thread`,
      });
    }
    if (value.context.type === 'page' && value.documentId !== undefined && value.context.id !== value.documentId) {
      issues.addIssue({
        code: 'custom',
        path: ['context', 'id'],
        message: 'context.id must equal documentId for a page thread',
      });
    }
  });

/**
 * The site's own id is the one identity the body cannot vouch for; the route
 * checks it against the path so two callers cannot open two site threads.
 */
export function siteContextMismatch(input: z.infer<typeof postThreadSchema>, siteId: string): string | null {
  if (input.context.type === 'site' && input.context.id !== siteId) {
    return 'context.id must be the site id for a site thread';
  }
  return null;
}

/** The keys the document session holds page data under; a path anywhere else would land outside the page. */
const DOCUMENT_DATA_ROOTS: readonly string[] = ['content', 'root', 'zones'];

const documentDataPath = z
  .string()
  .min(1)
  .refine((path) => DOCUMENT_DATA_ROOTS.includes(path.split('.')[0] ?? ''), {
    message: 'path must be within content, root or zones',
  });

const proposedOperation = z.object({
  op: z.enum(OPERATION_TYPES),
  path: documentDataPath,
  value: z.unknown().optional(),
  from: documentDataPath.optional(),
});

/** What an agent may write: a proposal always arrives undecided; deciding it is a separate request. */
const commentContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), body: commentBody, metadata: z.null().optional() }),
  z.object({
    kind: z.literal('agent_activity'),
    body: commentBody,
    metadata: z.object({ status: z.enum(ACTIVITY_STATUSES) }),
  }),
  z.object({
    kind: z.literal('agent_proposal'),
    body: commentBody,
    metadata: z.object({
      status: z.literal('proposed'),
      summary: z.string().trim().min(1).max(MAX_PROPOSAL_SUMMARY_LENGTH),
      operations: z.array(proposedOperation).min(1).max(MAX_PROPOSAL_OPERATIONS),
    }),
  }),
]) satisfies z.ZodType<CommentContent>;

/** A body on its own is a plain comment. */
export const postCommentSchema = z.preprocess(
  (value) =>
    typeof value === 'object' && value !== null && !('kind' in value) ? { ...value, kind: 'message' } : value,
  commentContentSchema,
);

export const updateCommentSchema = commentContentSchema;

export const decideProposalSchema = z.object({ decision: z.enum(['accepted', 'dismissed']) });

export const setThreadStatusSchema = z.object({ status: z.enum(THREAD_STATUSES) });

/** Well above the window a client reports within, so tuning that window cannot start rejecting reports. */
const MAX_ELAPSED_MS = 600_000;

// `z.uuid()` enforces the RFC 4122 version nibble, which agent and user ids in this
// system do not all carry; `UUID_PATTERN` is what admits the thread id on the same request.
const idSchema = z.string().regex(UUID_PATTERN, 'Invalid UUID');

export const reportUnansweredMentionSchema = z.object({
  commentId: idSchema,
  agentId: idSchema,
  elapsedMs: z.number().int().min(0).max(MAX_ELAPSED_MS),
});

export const listThreadsQuerySchema = z.object({
  documentId: z.uuid().optional(),
  status: z.enum([...THREAD_STATUSES, 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().optional(),
});

export const contextTypeSchema = z.enum(CONTEXT_TYPES);
