/**
 * The mention token grammar. The body is the canonical record of who was
 * mentioned, so what counts as a token and what stays plain text has to be
 * exact — the UI's comment component applies the same rule.
 */

import { describe, it, expect } from 'vitest';
import {
  findUnknownMentions,
  hydrateMentions,
  parseMentions,
} from '../../../src/services/threads/mentions-service';
import type { SiteMembers } from '../../../src/services/site-members-service';

const USER_ID = '6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b';
const AGENT_ID = '9a02b3c4-d5e6-4f70-8a9b-1c2d3e4f5a6b';
const STRANGER_ID = '00000000-0000-4000-8000-000000000000';

const roster: SiteMembers = {
  members: [
    { id: USER_ID, name: 'Ada Lovelace', email: 'ada@example.com', role: 'developer', avatar: null, source: 'local' },
  ],
  agents: [{ id: AGENT_ID, name: 'Copy Editor', role: 'editor', avatar: null, isGlobal: false }],
  rosterSource: 'unconfigured',
};

describe('parseMentions', () => {
  it('finds user and agent tokens in order', () => {
    const body = `Can \${mention|user:${USER_ID}} and \${mention|agent:${AGENT_ID}} look?`;
    expect(parseMentions(body)).toEqual([
      { type: 'user', id: USER_ID },
      { type: 'agent', id: AGENT_ID },
    ]);
  });

  it('treats anything that is not a well-formed token as text', () => {
    expect(parseMentions('@ada, @nobody, ${mention|user:not-a-uuid}, ${mention|team:' + USER_ID + '}')).toEqual([]);
  });

  it('normalizes the id to lower case', () => {
    expect(parseMentions(`\${mention|user:${USER_ID.toUpperCase()}}`)).toEqual([{ type: 'user', id: USER_ID }]);
  });
});

describe('findUnknownMentions', () => {
  it('accepts members and agents on the roster', () => {
    const mentions = parseMentions(`\${mention|user:${USER_ID}} \${mention|agent:${AGENT_ID}}`);
    expect(findUnknownMentions(mentions, roster)).toEqual([]);
  });

  it('names an id missing from the roster', () => {
    const mentions = parseMentions(`\${mention|user:${STRANGER_ID}}`);
    expect(findUnknownMentions(mentions, roster)).toEqual([{ type: 'user', id: STRANGER_ID }]);
  });

  it('does not let a user id pass as an agent', () => {
    const mentions = parseMentions(`\${mention|agent:${USER_ID}}`);
    expect(findUnknownMentions(mentions, roster)).toHaveLength(1);
  });
});

describe('hydrateMentions', () => {
  it('returns each mention once with its roster name', () => {
    const body = `\${mention|user:${USER_ID}} again \${mention|user:${USER_ID}} and \${mention|agent:${AGENT_ID}}`;
    expect(hydrateMentions(body, roster)).toEqual([
      { type: 'user', id: USER_ID, name: 'Ada Lovelace' },
      { type: 'agent', id: AGENT_ID, name: 'Copy Editor' },
    ]);
  });

  it('keeps a departed member with a null name', () => {
    expect(hydrateMentions(`\${mention|user:${STRANGER_ID}}`, roster)).toEqual([
      { type: 'user', id: STRANGER_ID, name: null },
    ]);
  });
});
