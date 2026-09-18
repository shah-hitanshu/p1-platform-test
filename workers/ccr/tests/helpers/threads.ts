import type { Comment, ThreadOverview } from '../../src/types/threads';

export const SITE_ID = '11111111-1111-4111-8111-111111111111';
export const THREAD_ID = '22222222-2222-4222-8222-222222222222';
export const COMMENT_ID = '33333333-3333-4333-8333-333333333333';
export const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
export const USER_ID = '55555555-5555-4555-8555-555555555555';
export const AGENT_ID = '66666666-6666-4666-8666-666666666666';

export function makeThread(overrides: Partial<ThreadOverview> = {}): ThreadOverview {
  return {
    id: THREAD_ID,
    siteId: SITE_ID,
    context: { type: 'block', id: 'Hero-3f2a' },
    documentId: DOCUMENT_ID,
    status: 'open',
    commentCount: 1,
    lastCommentAt: '2026-09-12T10:00:00.000Z',
    createdAt: '2026-09-12T10:00:00.000Z',
    updatedAt: '2026-09-12T10:00:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: COMMENT_ID,
    threadId: THREAD_ID,
    kind: 'message',
    body: 'Can we tighten this headline?',
    author: { type: 'user', id: USER_ID, name: 'Ada Lovelace', avatar: null },
    mentions: [],
    createdAt: '2026-09-12T10:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}
