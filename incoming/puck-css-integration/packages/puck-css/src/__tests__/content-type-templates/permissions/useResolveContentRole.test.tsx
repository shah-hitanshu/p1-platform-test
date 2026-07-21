import { describe, it, expect } from 'vitest';
import { mapCssRoleToContentRole } from '../../../features/content-type-templates/permissions/useResolveContentRole.js';

describe('mapCssRoleToContentRole', () => {
  it('maps ADMIN to admin', () => {
    expect(mapCssRoleToContentRole('ADMIN')).toBe('admin');
  });

  it('maps EDITOR to editor', () => {
    expect(mapCssRoleToContentRole('EDITOR')).toBe('editor');
  });

  it('maps VIEWER to junior-editor', () => {
    expect(mapCssRoleToContentRole('VIEWER')).toBe('junior-editor');
  });

  it('maps NO_ACCESS to junior-editor', () => {
    expect(mapCssRoleToContentRole('NO_ACCESS')).toBe('junior-editor');
  });
});
