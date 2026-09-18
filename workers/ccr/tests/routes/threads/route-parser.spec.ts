/**
 * Route parser tests for the threads endpoints.
 *
 * Five paths share one handler; the parameters they extract decide which
 * endpoint (and which permission) a request reaches, so each shape is pinned.
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../../src/routes/route-parser';

describe('parseRoute — threads', () => {
  it('parses the site threads collection', () => {
    expect(parseRoute('/api/sites/site-1/threads')).toEqual({
      handler: 'threads',
      params: { siteId: 'site-1', threadId: undefined, subResource: undefined },
    });
  });

  it('parses one thread', () => {
    expect(parseRoute('/api/sites/site-1/threads/thread-1')).toEqual({
      handler: 'threads',
      params: { siteId: 'site-1', threadId: 'thread-1', subResource: undefined },
    });
  });

  it('parses the comments and status sub-resources', () => {
    expect(parseRoute('/api/sites/site-1/threads/thread-1/comments')?.params).toMatchObject({
      threadId: 'thread-1',
      subResource: 'comments',
    });
    expect(parseRoute('/api/sites/site-1/threads/thread-1/status')?.params).toMatchObject({
      threadId: 'thread-1',
      subResource: 'status',
    });
  });

  it('parses one comment and its decision', () => {
    expect(parseRoute('/api/sites/site-1/threads/thread-1/comments/comment-1')?.params).toMatchObject({
      threadId: 'thread-1',
      subResource: 'comments',
      commentId: 'comment-1',
      commentAction: undefined,
    });
    expect(parseRoute('/api/sites/site-1/threads/thread-1/comments/comment-1/decision')?.params).toMatchObject({
      threadId: 'thread-1',
      subResource: 'comments',
      commentId: 'comment-1',
      commentAction: 'decision',
    });
  });

  it('does not claim an unknown sub-resource under a thread', () => {
    expect(parseRoute('/api/sites/site-1/threads/thread-1/likes')?.handler).not.toBe('threads');
  });

  it('does not claim anything under status or an unknown action under a comment', () => {
    expect(parseRoute('/api/sites/site-1/threads/thread-1/status/x')?.handler).not.toBe('threads');
    expect(parseRoute('/api/sites/site-1/threads/thread-1/comments/comment-1/likes')?.handler).not.toBe('threads');
  });

  it('parses the per-context listing and decodes the context id', () => {
    expect(parseRoute('/api/sites/site-1/contexts/block/Hero-3f2a%2Fx/threads')).toEqual({
      handler: 'threads',
      params: { siteId: 'site-1', contextType: 'block', contextId: 'Hero-3f2a/x' },
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute('/api/sites/site-1/threads/')?.handler).toBe('threads');
  });

  it('leaves the members path on its own handler', () => {
    expect(parseRoute('/api/sites/site-1/members')?.handler).toBe('site-members');
  });
});
