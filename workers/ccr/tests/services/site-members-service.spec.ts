/**
 * Role folding for the site members roster.
 *
 * The route tests cover this through HTTP; these cover it directly, because the
 * tie-break is the one rule here that is easy to get subtly wrong and the
 * hardest to see through a response body.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeSource,
  strongerGrant,
  type RoleGrant,
} from '../../src/services/site-members-service';

const local = (role: RoleGrant['role']): RoleGrant => ({ role, source: 'local' });
const mas = (role: RoleGrant['role']): RoleGrant => ({ role, source: 'mas' });

describe('strongerGrant', () => {
  it('takes the higher tier regardless of which side holds it', () => {
    expect(strongerGrant(local('team_member'), mas('admin'))).toEqual(mas('admin'));
    expect(strongerGrant(mas('admin'), local('team_member'))).toEqual(mas('admin'));
  });

  it('prefers the local grant when two different roles rank the same tier', () => {
    // developer and editor both map to EDITOR, so the tier cannot decide.
    expect(strongerGrant(local('developer'), mas('editor'))).toEqual(local('developer'));
    expect(strongerGrant(mas('editor'), local('developer'))).toEqual(local('developer'));
  });

  it('keeps owner above the editor tier', () => {
    expect(strongerGrant(local('editor'), mas('owner'))).toEqual(mas('owner'));
  });

  it('treats owner and admin as one tier, so the local side wins', () => {
    expect(strongerGrant(local('owner'), mas('admin'))).toEqual(local('owner'));
    expect(strongerGrant(mas('admin'), local('owner'))).toEqual(local('owner'));
  });

  it('is stable when both grants are identical', () => {
    expect(strongerGrant(local('developer'), local('developer'))).toEqual(local('developer'));
  });
});

describe('normalizeSource', () => {
  it('recognizes the upstream source', () => {
    expect(normalizeSource('mas')).toBe('mas');
  });

  it('treats anything else as a local grant', () => {
    expect(normalizeSource('local')).toBe('local');
    expect(normalizeSource('')).toBe('local');
    expect(normalizeSource('something-new')).toBe('local');
  });
});
