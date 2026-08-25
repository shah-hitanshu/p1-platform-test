import { describe, it, expect } from 'vitest';
import { makePrincipal } from './principal';

describe('makePrincipal', () => {
  it('keeps a getter deferred instead of freezing its value', () => {
    // Integration fixtures are built in a `describe` body but read ids assigned
    // in `beforeAll`, and pass a getter to bridge that gap. A spread would
    // evaluate it immediately and store `undefined`.
    let assignedLater: string | undefined = undefined;

    const principal = makePrincipal({
      id: 'admin',
      type: 'user',
      get dbUserId(): string | undefined {
        return assignedLater;
      },
    });

    expect(principal.dbUserId).toBeUndefined();

    assignedLater = '00000000-0000-4000-8000-000000000001';

    expect(principal.dbUserId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('takes plain values as overrides', () => {
    const principal = makePrincipal({
      id: 'svc-1',
      type: 'service',
      pantheonSiteRoles: { 'site-1': 'admin' },
    });

    expect(principal).toMatchObject({
      id: 'svc-1',
      type: 'service',
      pantheonSiteRoles: { 'site-1': 'admin' },
    });
  });

  it('defaults only the two forwarded fields', () => {
    const principal = makePrincipal({ id: 'user-1', type: 'user' });

    expect(principal.pantheonSiteRoles).toEqual({});
    expect(new Date(principal.tokenExpiry).getTime()).toBeGreaterThan(Date.now());
  });
});
