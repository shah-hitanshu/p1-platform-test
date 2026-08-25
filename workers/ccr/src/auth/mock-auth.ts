/**
 * Mock Authentication (local development only)
 *
 * Fixture identities and the mock login endpoints that issue tokens for them,
 * kept out of the production auth path in `middleware/authentication.ts`.
 */

import { MockIdentityProvider } from './mock-identity-provider';
import type { MockIdentityConfig } from '../types';
import { jsonResponse, errorResponse } from '../utils/http-helpers';
import type { Env } from '../env';

/**
 * Stands in for the broker JWT's `picture` claim so local dev renders avatars
 * without Auth0/KMS. `f=y` forces a generated identicon, never a real person.
 */
function mockAvatarUrl(userId: string): string {
  return `https://www.gravatar.com/avatar/${userId.replace(/-/g, '')}?d=identicon&f=y&s=96`;
}

/**
 * Default mock identity configuration for development.
 * User/agent IDs must be valid UUIDs to match database schema.
 */
export const DEFAULT_MOCK_CONFIG: MockIdentityConfig = {
  tokenExpiry: '24h',
  users: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'alice@example.com',
      name: 'Alice Developer',
      avatarUrl: mockAvatarUrl('11111111-1111-1111-1111-111111111111'),
      siteRoles: {
        'site-123': 'admin',
        'site-456': 'developer',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'bob@example.com',
      name: 'Bob Reviewer',
      avatarUrl: mockAvatarUrl('22222222-2222-2222-2222-222222222222'),
      siteRoles: {
        'site-123': 'team_member',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'carol@example.com',
      name: 'Carol Editor',
      avatarUrl: mockAvatarUrl('33333333-3333-3333-3333-333333333333'),
      siteRoles: {
        'site-123': 'developer',
        'site-456': 'admin',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
  ],
  defaultSiteRoles: {},
  agents: [
    {
      // ID must match database: a0000000-0000-0000-0000-000000000001 (Zappy)
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Zappy AI Assistant',
      apiKey: 'test-agent-key-zappy',
      siteRoles: {
        'site-123': 'editor',
        '5da7f0d0-81d8-4e92-9a4b-a4cb07090768': 'admin',
        '35b800c4-6010-4908-a724-f1512e2a2144': 'admin',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      // ID must match database: a0000000-0000-0000-0000-000000000002 (Helper)
      id: 'a0000000-0000-0000-0000-000000000002',
      name: 'Helper Bot',
      apiKey: 'test-agent-key-helper',
      siteRoles: { 'site-123': 'viewer', 'site-456': 'editor' },
    },
  ],
};

/**
 * Get the MockIdentityProvider for development-only auth endpoints.
 * These endpoints (token issuance, user listing) are mock-specific.
 */
export function getMockIdentityProvider(env: Env): MockIdentityProvider {
  return new MockIdentityProvider({
    config: DEFAULT_MOCK_CONFIG,
    jwtSecret: env.MOCK_JWT_SECRET ?? 'development-secret-must-be-at-least-32-characters',
    tokenExpiry: '24h',
  });
}

/**
 * Handle mock auth endpoints for frontend login (development only).
 */
export async function handleAuthRoutes(
  request: Request,
  path: string,
  env: Env,
): Promise<Response | null> {
  const mockProvider = getMockIdentityProvider(env);

  // GET /api/auth/users - List available users
  if (path === '/api/auth/users' && request.method === 'GET') {
    return jsonResponse({
      users: DEFAULT_MOCK_CONFIG.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        siteRoles: u.siteRoles,
      })),
      agents: DEFAULT_MOCK_CONFIG.agents.map((a) => ({
        id: a.id,
        name: a.name,
        siteRoles: a.siteRoles,
      })),
    });
  }

  // POST /api/auth/token - Issue token for user
  if (path === '/api/auth/token' && request.method === 'POST') {
    const rawBody: unknown = await request.json();
    const body = rawBody as { userId?: string; agentApiKey?: string };

    // Try user token
    if (typeof body.userId === 'string' && body.userId.length > 0) {
      const user = mockProvider.getUser(body.userId);
      if (user === undefined) {
        return errorResponse('User not found', 404);
      }
      const token = await mockProvider.issueToken(body.userId);
      return jsonResponse({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          siteRoles: user.siteRoles,
        },
      });
    }

    return errorResponse('userId is required', 400);
  }

  return null;
}
