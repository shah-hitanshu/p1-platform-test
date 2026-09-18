/**
 * canComment gating.
 *
 * Commenting is the first permission every role holds rather than a tier: the
 * flag exists so a custom role can grant or withhold it on its own. These pin
 * that every role that can view a site can also take part in its threads.
 */

import { describe, it, expect } from 'vitest';
import { ROLES, getRolePermissions } from '../../src/auth/roles';
import type { RoleName } from '../../src/types';

describe('canComment', () => {
  it('is held by every role that can view', () => {
    const names = Object.keys(ROLES) as RoleName[];
    for (const name of names) {
      expect(ROLES[name].canComment).toBe(ROLES[name].canView);
    }
  });

  it('is withheld from NO_ACCESS alone', () => {
    const withheld = (Object.keys(ROLES) as RoleName[])
      .filter((name) => !ROLES[name].canComment);

    expect(withheld).toEqual(['NO_ACCESS']);
  });

  it('is reported through getRolePermissions, which the role endpoint serves', () => {
    expect(getRolePermissions('VIEWER').canComment).toBe(true);
    expect(getRolePermissions('EDITOR').canComment).toBe(true);
    expect(getRolePermissions('ADMIN').canComment).toBe(true);
    expect(getRolePermissions('NO_ACCESS').canComment).toBe(false);
  });
});
