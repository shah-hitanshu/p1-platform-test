/**
 * canManageTemplates gating.
 *
 * Template authoring used to be gated by a raw `roleName !== 'ADMIN'` check at
 * nine call sites, each reporting `canEditDocuments` as the missing permission —
 * a permission EDITOR actually holds. These pin the flag as the single source of
 * that decision, and pin the reported permission to the one really required.
 */

import { describe, it, expect } from 'vitest';
import { ROLES, getRolePermissions } from '../../src/auth/roles';
import type { RoleName } from '../../src/types';

describe('canManageTemplates', () => {
  it('is granted to ADMIN alone', () => {
    const granted = (Object.keys(ROLES) as RoleName[])
      .filter((name) => ROLES[name].canManageTemplates);

    expect(granted).toEqual(['ADMIN']);
  });

  // The distinction the old check blurred: an editor may edit a document's own
  // content but may not author the template other documents inherit from.
  it('is independent of canEditDocuments, which EDITOR does hold', () => {
    expect(ROLES.EDITOR.canEditDocuments).toBe(true);
    expect(ROLES.EDITOR.canManageTemplates).toBe(false);
  });

  it('is reported through getRolePermissions, which the role endpoint serves', () => {
    expect(getRolePermissions('ADMIN').canManageTemplates).toBe(true);
    expect(getRolePermissions('EDITOR').canManageTemplates).toBe(false);
    expect(getRolePermissions('VIEWER').canManageTemplates).toBe(false);
    expect(getRolePermissions('NO_ACCESS').canManageTemplates).toBe(false);
  });
});
