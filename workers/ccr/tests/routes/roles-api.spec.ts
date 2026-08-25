/**
 * Custom Role Management API Tests
 *
 * Tests for the advisory endpoint listing the user and agent role catalogs.
 */

import { describe, it, expect } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import type { RoleOption } from '../../src/auth/role-catalog';
import { readJson } from '../helpers/http';
import { parseRoute } from '../../src/routes/route-parser';
import { handleRolesRoutes } from '../../src/routes/roles-api';

describe('Custom Role Management API', () => {
  const userPrincipal: AuthenticatedPrincipal = {
    id: 'user-1',
    type: 'user',
    email: 'user@example.com',
    pantheonSiteRoles: { 'site-1': 'team_member' },
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
    authProvider: 'auth0',
  };

  describe('GET /api/sites/{siteId}/roles', () => {
    it('returns the user and agent role catalogs', async () => {
      const request = new Request('https://api.example.com/api/sites/site-1/roles');
      const response = handleRolesRoutes(request, {
        siteId: 'site-1',
        principal: userPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      const userRoles = body.userRoles as RoleOption<string>[];
      const agentRoles = body.agentRoles as RoleOption<string>[];

      expect(userRoles.map((r) => r.value)).toEqual([
        'admin',
        'developer',
        'team_member',
        'author',
        'editor',
      ]);
      expect(agentRoles.map((r) => r.value)).toEqual(['viewer', 'editor', 'admin']);
    });

    it('does not offer owner in the user role catalog', async () => {
      const request = new Request('https://api.example.com/api/sites/site-1/roles');
      const response = handleRolesRoutes(request, {
        siteId: 'site-1',
        principal: userPrincipal,
      });

      const body = await readJson(response);
      const userRoles = body.userRoles as RoleOption<string>[];

      expect(userRoles.some((r) => r.value === 'owner')).toBe(false);
    });

    it('returns 405 for non-GET methods', async () => {
      const request = new Request('https://api.example.com/api/sites/site-1/roles', {
        method: 'POST',
      });
      const response = handleRolesRoutes(request, {
        siteId: 'site-1',
        principal: userPrincipal,
      });

      expect(response.status).toBe(405);
    });

    it('returns 400 when siteId is empty', async () => {
      const request = new Request('https://api.example.com/api/sites//roles');
      const response = handleRolesRoutes(request, {
        siteId: '',
        principal: userPrincipal,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('parseRoute — site roles', () => {
    it('parses the site roles path', () => {
      expect(parseRoute('/api/sites/site-1/roles')).toEqual({
        handler: 'site-roles',
        params: { siteId: 'site-1' },
      });
    });

    it('does not swallow agent role routes', () => {
      expect(parseRoute('/api/agents/agent-1/roles')?.handler).toBe('agent-roles');
      expect(parseRoute('/api/sites/site-1/agent-roles')?.handler).toBe('site-agent-roles');
    });

    it('does not match a role id suffix', () => {
      expect(parseRoute('/api/sites/site-1/roles/some-id')?.handler).not.toBe('site-roles');
    });
  });
});
