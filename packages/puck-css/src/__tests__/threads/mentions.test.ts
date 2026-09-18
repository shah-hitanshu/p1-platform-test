import { describe, it, expect } from 'vitest';
import type { SiteMembers } from '@pantheon-systems/css-client';

import {
  filterMentionCandidates,
  insertMention,
  mentionCandidates,
  mentionQueryAt,
  serializeMentions,
  type MentionCandidate,
} from '../../features/threads/mentions.js';

const roster: SiteMembers = {
  members: [
    { id: 'u-1', name: 'Marco Reyes', email: 'marco@example.com', role: 'editor', avatar: null },
    { id: 'u-2', name: 'Nadia Brooks', email: null, role: 'owner', avatar: 'https://img/nadia.png' },
    { id: 'u-3', name: null, email: 'ghost@example.com', role: 'author', avatar: null },
    { id: 'u-4', name: null, email: null, role: 'author', avatar: null },
  ],
  agents: [{ id: 'a-1', name: 'Pantheon Agent', role: 'editor', avatar: null, isGlobal: true }],
};

const agent: MentionCandidate = { type: 'agent', id: 'a-1', name: 'Pantheon Agent', role: 'Editor', avatar: null };
const marco: MentionCandidate = { type: 'user', id: 'u-1', name: 'Marco Reyes', role: 'Editor', avatar: null };
const marc: MentionCandidate = { type: 'user', id: 'u-9', name: 'Marco', role: 'Author', avatar: null };

describe('mentionCandidates', () => {
  it('lists agents first, names people by email when that is all there is, and drops the nameless', () => {
    const candidates = mentionCandidates(roster);

    expect(candidates.map((c) => c.name)).toEqual(['Pantheon Agent', 'Marco Reyes', 'Nadia Brooks', 'ghost@example.com']);
    expect(candidates[0]).toMatchObject({ type: 'agent', id: 'a-1' });
    expect(candidates[2]).toMatchObject({ role: 'Site owner', avatar: 'https://img/nadia.png' });
  });
});

describe('filterMentionCandidates', () => {
  it('matches anywhere in the name regardless of case', () => {
    const all = [agent, marco];
    expect(filterMentionCandidates(all, '')).toEqual(all);
    expect(filterMentionCandidates(all, 'REY')).toEqual([marco]);
    expect(filterMentionCandidates(all, 'nobody')).toEqual([]);
  });
});

describe('mentionQueryAt', () => {
  it('finds the @ that starts the word under the caret', () => {
    expect(mentionQueryAt('hey @mar', 8)).toEqual({ start: 4, end: 8, query: 'mar' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  it('is not a mention once a space follows the @, or when the @ is inside a word', () => {
    expect(mentionQueryAt('hey @ there', 11)).toBeNull();
    expect(mentionQueryAt('mail me@example.com', 19)).toBeNull();
    expect(mentionQueryAt('no at sign', 10)).toBeNull();
  });

  it('only looks at the text before the caret', () => {
    expect(mentionQueryAt('@marco later', 3)).toEqual({ start: 0, end: 3, query: 'ma' });
  });
});

describe('insertMention', () => {
  it('replaces the query with the full name and a trailing space', () => {
    const result = insertMention('ask @mar about it', { start: 4, end: 8, query: 'mar' }, marco);

    expect(result.text).toBe('ask @Marco Reyes  about it');
    expect(result.caret).toBe('ask @Marco Reyes '.length);
  });
});

describe('serializeMentions', () => {
  it('turns chosen names into tokens and leaves everything else alone', () => {
    const text = '@Pantheon Agent shorten this for @Marco Reyes, not @Someone Else';

    expect(serializeMentions(text, [agent, marco])).toBe(
      '${mention|agent:a-1} shorten this for ${mention|user:u-1}, not @Someone Else',
    );
  });

  it('prefers the longer of two names that share a prefix', () => {
    expect(serializeMentions('@Marco Reyes and @Marco', [marc, marco])).toBe(
      '${mention|user:u-1} and ${mention|user:u-9}',
    );
  });

  it('does not tokenise a name the reader typed but never picked', () => {
    expect(serializeMentions('@Marco Reyes', [])).toBe('@Marco Reyes');
  });
});
