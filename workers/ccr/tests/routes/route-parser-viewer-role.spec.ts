/**
 * Route parser tests for the viewer role endpoint.
 *
 * The path sits under /api/sites/.../auth/, close enough to the /api/auth/*
 * prefix that a regression could route it to the auth handler instead.
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';

describe('parseRoute — viewer role', () => {
  it('parses the branch-scoped role path', () => {
    const route = parseRoute('/api/sites/site-1/branches/branch-1/auth/role');

    expect(route).toEqual({
      handler: 'viewer-role',
      params: { siteId: 'site-1', branchId: 'branch-1' },
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute('/api/sites/site-1/branches/branch-1/auth/role/')?.handler)
      .toBe('viewer-role');
  });

  it('does not swallow the global auth routes', () => {
    expect(parseRoute('/api/auth/me')?.handler).toBe('auth');
  });

  it('does not match a bare auth segment under a branch', () => {
    expect(parseRoute('/api/sites/site-1/branches/branch-1/auth')?.handler)
      .not.toBe('viewer-role');
  });
});
