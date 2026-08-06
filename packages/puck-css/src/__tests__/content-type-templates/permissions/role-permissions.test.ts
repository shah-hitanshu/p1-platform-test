/**
 * Role Permissions Tests
 *
 * Tests for role-based permission calculations.
 */

import { describe, it, expect } from 'vitest';
import {
  getPermissionsForRole,
  canPerformStructuralAction,
  canEditProps,
  canOverrideUrl,
  mergePermissions,
} from '../../../features/content-type-templates/permissions/role-permissions.js';

describe('getPermissionsForRole', () => {
  it('grants full permissions to admin', () => {
    const perms = getPermissionsForRole('admin');
    expect(perms.canAddComponents).toBe(true);
    expect(perms.canRemoveComponents).toBe(true);
    expect(perms.canMoveComponents).toBe(true);
    expect(perms.canEditProps).toBe(true);
    expect(perms.canOverrideUrl).toBe(true);
  });

  it('grants structural permissions to editor but locks pinned components', () => {
    const perms = getPermissionsForRole('editor');
    expect(perms.canAddComponents).toBe(true);
    expect(perms.canRemoveComponents).toBe(true);
    expect(perms.canMoveComponents).toBe(true);
    expect(perms.canEditProps).toBe(true);
    expect(perms.canOverrideUrl).toBe(true);
  });

  it('restricts junior-editor to prop editing only', () => {
    const perms = getPermissionsForRole('junior-editor');
    expect(perms.canAddComponents).toBe(false);
    expect(perms.canRemoveComponents).toBe(false);
    expect(perms.canMoveComponents).toBe(false);
    expect(perms.canEditProps).toBe(true);
    expect(perms.canOverrideUrl).toBe(false);
  });
});

describe('canPerformStructuralAction', () => {
  it('allows admin to perform structural actions', () => {
    expect(canPerformStructuralAction('admin')).toBe(true);
  });

  it('allows editor to perform structural actions', () => {
    expect(canPerformStructuralAction('editor')).toBe(true);
  });

  it('denies junior-editor from structural actions', () => {
    expect(canPerformStructuralAction('junior-editor')).toBe(false);
  });
});

describe('canEditProps', () => {
  it('allows all roles to edit props', () => {
    expect(canEditProps('admin')).toBe(true);
    expect(canEditProps('editor')).toBe(true);
    expect(canEditProps('junior-editor')).toBe(true);
  });
});

describe('canOverrideUrl', () => {
  it('allows admin to override URL', () => {
    expect(canOverrideUrl('admin')).toBe(true);
  });

  it('allows editor to override URL', () => {
    expect(canOverrideUrl('editor')).toBe(true);
  });

  it('denies junior-editor from overriding URL', () => {
    expect(canOverrideUrl('junior-editor')).toBe(false);
  });
});

describe('mergePermissions', () => {
  it('combines template permissions with historical lock', () => {
    const templatePerms = getPermissionsForRole('admin');
    const merged = mergePermissions(templatePerms, true);

    expect(merged.canAddComponents).toBe(false);
    expect(merged.canRemoveComponents).toBe(false);
    expect(merged.canMoveComponents).toBe(false);
    expect(merged.canEditProps).toBe(false);
  });

  it('preserves template permissions when not locked', () => {
    const templatePerms = getPermissionsForRole('admin');
    const merged = mergePermissions(templatePerms, false);

    expect(merged.canAddComponents).toBe(true);
    expect(merged.canRemoveComponents).toBe(true);
    expect(merged.canMoveComponents).toBe(true);
    expect(merged.canEditProps).toBe(true);
  });

  it('applies most restrictive permissions', () => {
    const templatePerms = getPermissionsForRole('junior-editor');
    const merged = mergePermissions(templatePerms, false);

    expect(merged.canAddComponents).toBe(false);
    expect(merged.canRemoveComponents).toBe(false);
    expect(merged.canMoveComponents).toBe(false);
    expect(merged.canEditProps).toBe(true);
  });
});
