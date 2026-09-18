import { describe, it, expect } from 'vitest';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { versionAuthorName } from '../../src/versioning/utils/versionAuthorName.js';

const version: DocumentVersion = {
  id: 'v1',
  documentId: 'd1',
  versionNumber: 1,
  snapshot: {},
  createdAt: '2026-01-01T00:00:00Z',
  createdById: 'user-1',
  createdByType: 'user',
};

describe('versionAuthorName', () => {
  it('names the agent and who it acted for when the version is attributed', () => {
    const attributed = {
      ...version,
      attribution: {
        agent: { id: 'agent-1', name: 'Copy Editor' },
        onBehalfOf: { id: 'user-1', name: 'Dana Kim' },
        description: '',
      },
    };
    const name = versionAuthorName(attributed, { currentUser: { id: 'user-1', name: 'Dana' } });
    expect(name).toContain('Copy Editor');
    expect(name).toContain('Dana Kim');
  });

  it('prefers a name the caller resolves', () => {
    const name = versionAuthorName(version, {
      currentUser: { id: 'user-1', name: 'Me' },
      resolveAuthorName: () => 'Dana from the roster',
    });
    expect(name).toBe('Dana from the roster');
  });

  it('falls back to the current user\'s name, then email, for their own versions', () => {
    expect(versionAuthorName(version, { currentUser: { id: 'user-1', name: 'Dana', email: 'd@x.io' } })).toBe('Dana');
    expect(versionAuthorName(version, { currentUser: { id: 'user-1', email: 'd@x.io' } })).toBe('d@x.io');
    expect(versionAuthorName(version, { currentUser: { id: 'user-1' } })).toBe('You');
  });

  it('shows an agent\'s id and a generic label for other people when nothing resolves', () => {
    expect(versionAuthorName({ ...version, createdById: 'agent-7', createdByType: 'agent' }, {})).toBe('agent-7');
    expect(versionAuthorName(version, { currentUser: { id: 'someone-else' } })).toBe('User');
  });
});
