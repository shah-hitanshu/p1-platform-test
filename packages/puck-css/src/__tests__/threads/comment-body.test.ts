import { describe, it, expect } from 'vitest';
import type { Comment } from '@pantheon-systems/css-client';
import { commentBodyParts, commentBodyText } from '../../features/threads/comment-body.js';

function comment(body: string, mentions: Comment['mentions'] = []): Comment {
  return {
    id: 'c-1',
    threadId: 't-1',
    kind: 'message',
    body,
    author: { type: 'user', id: 'user-1', name: 'Nick', avatar: null },
    mentions,
    createdAt: '2026-09-13T00:00:00Z',
    editedAt: null,
  };
}

describe('commentBodyParts', () => {
  it('splits text around the members it mentions', () => {
    const c = comment('${mention|agent:a-1} tighten this, ${mention|user:u-2}?', [
      { type: 'agent', id: 'a-1', name: 'Pantheon Agent' },
      { type: 'user', id: 'u-2', name: 'Marco' },
    ]);

    expect(commentBodyParts(c)).toEqual([
      { kind: 'mention', type: 'agent', name: 'Pantheon Agent' },
      { kind: 'text', text: ' tighten this, ' },
      { kind: 'mention', type: 'user', name: 'Marco' },
      { kind: 'text', text: '?' },
    ]);
    expect(commentBodyText(c)).toBe('@Pantheon Agent tighten this, @Marco?');
  });

  it('leaves a token alone when no mention backs it', () => {
    const c = comment('hi ${mention|user:ghost}');
    expect(commentBodyParts(c)).toEqual([{ kind: 'text', text: 'hi ${mention|user:ghost}' }]);
  });

  it('names a member who has since left', () => {
    const c = comment('${mention|user:u-9} ok', [{ type: 'user', id: 'u-9', name: null }]);
    expect(commentBodyText(c)).toBe('@former member ok');
  });
});
