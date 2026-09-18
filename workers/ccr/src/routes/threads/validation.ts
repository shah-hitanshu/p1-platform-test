/**
 * Request schemas for the threads endpoints. Kept apart from the
 * handlers so a router with validation middleware can mount them directly.
 */

import { z } from 'zod';
import {
  CONTEXT_TYPES,
  DEFAULT_LIST_LIMIT,
  MAX_BODY_LENGTH,
  MAX_CONTEXT_ID_LENGTH,
  MAX_LIST_LIMIT,
  THREAD_STATUSES,
} from '../../types/threads';

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

export const postCommentSchema = z.object({ body: commentBody });

export const setThreadStatusSchema = z.object({ status: z.enum(THREAD_STATUSES) });

export const listThreadsQuerySchema = z.object({
  documentId: z.uuid().optional(),
  status: z.enum([...THREAD_STATUSES, 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().optional(),
});

export const contextTypeSchema = z.enum(CONTEXT_TYPES);
