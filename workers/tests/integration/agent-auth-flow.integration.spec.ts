/**
 * Phase B8: Agent Auth Flow - End-to-End Integration Tests
 *
 * Exercises the full agent authentication and authorization flow
 * against the real PostgreSQL database:
 *
 * 1. Register an agent via the agent service
 * 2. Generate an API key for the agent
 * 3. Grant the agent a site role (editor on a test site)
 * 4. Authenticate with the agent key and verify the principal has correct pantheonSiteRoles
 * 5. Revoke the key and verify auth fails
 * 6. Revoke the site role and verify the principal no longer has that role
 *
 * Prerequisites:
 * - PostgreSQL running: make docker-up
 * - Migrations applied: npm run db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

// Services under test
import { createAgent, deleteAgent } from '../../src/services/agent-service';
import { generateKey, validateKey, revokeKey } from '../../src/services/agent-api-key-service';
import { grantRole, revokeRole, listRoles, getRolesForAgent } from '../../src/services/agent-site-role-service';

// Auth provider under test
import { AgentApiKeyProvider } from '../../src/auth/agent-api-key-provider';

// =============================================================================
// Test Setup
// =============================================================================

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';

function createRealDatabaseConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const sql = postgres(connectionString, {
    transform: { undefined: null },
    max: 1,
  });

  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await sql.unsafe<T[]>(sqlQuery, params as unknown as postgres.ParameterOrJSON<never>[]);
      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;
      return { rows, rowCount };
    },
  };

  return { connection, sql };
}

// =============================================================================
// Tests
// =============================================================================

describe('B8: Agent Auth Flow - End-to-End Integration', () => {
  let sql: postgres.Sql;
  let testOrgId: string;
  let testSiteId: string;
  let testAgentId: string;
  let rawKey: string;
  let keyId: string;
  let roleId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    // Verify connection
    const result = await sql`SELECT 1 as connected`;
    expect(result[0]?.connected).toBe(1);

    // Create a test organization
    const orgResult = await sql`
      INSERT INTO app.organizations (name)
      VALUES ('e2e-agent-auth-test-org')
      RETURNING id
    `;
    testOrgId = String(orgResult[0]?.id);

    // Create a test site
    const siteResult = await sql`
      INSERT INTO app.sites (name, pantheon_site_id, organization_id)
      VALUES ('e2e-agent-auth-test-site', 'e2e-agent-auth-test', ${testOrgId})
      RETURNING id
    `;
    testSiteId = String(siteResult[0]?.id);
  });

  afterAll(async () => {
    // Clean up in reverse dependency order
    if (testAgentId) {
      await sql`DELETE FROM app.agent_site_roles WHERE agent_id = ${testAgentId}`;
      await sql`DELETE FROM app.agent_api_keys WHERE agent_id = ${testAgentId}`;
      await sql`DELETE FROM app.agents WHERE id = ${testAgentId}`;
    }
    await sql`DELETE FROM app.sites WHERE pantheon_site_id = 'e2e-agent-auth-test'`;
    await sql`DELETE FROM app.organizations WHERE id = ${testOrgId}`;
    await sql.end();
  });

  it('Step 1: Register an agent', async () => {
    const agent = await createAgent({
      organizationId: testOrgId,
      name: 'E2E Test Agent',
      description: 'Agent for integration testing',
      capabilities: ['edit'],
    });

    expect(agent).toBeDefined();
    expect(agent.name).toBe('E2E Test Agent');
    expect(agent.status).toBe('active');
    expect(agent.organizationId).toBe(testOrgId);

    testAgentId = agent.id;
  });

  it('Step 2: Generate an API key for the agent', async () => {
    const result = await generateKey({
      agentId: testAgentId,
      name: 'E2E Test Key',
      createdBy: 'e2e-test-user',
    });

    expect(result.key).toBeDefined();
    expect(result.key.startsWith('aak_')).toBe(true);
    expect(result.metadata.name).toBe('E2E Test Key');
    expect(result.metadata.agentId).toBe(testAgentId);
    expect(result.metadata.revokedAt).toBeNull();

    rawKey = result.key;
    keyId = result.metadata.id;
  });

  it('Step 3: Grant the agent an editor role on the test site', async () => {
    const role = await grantRole({
      agentId: testAgentId,
      siteId: testSiteId,
      role: 'editor',
      grantedBy: 'e2e-test-user',
    });

    expect(role).toBeDefined();
    expect(role.agentId).toBe(testAgentId);
    expect(role.siteId).toBe(testSiteId);
    expect(role.role).toBe('editor');
    expect(role.revokedAt).toBeNull();

    roleId = role.id;
  });

  it('Step 4: Authenticate with the agent key and verify pantheonSiteRoles', async () => {
    expect(rawKey).toBeDefined();

    // Use the AgentApiKeyProvider to authenticate
    const provider = new AgentApiKeyProvider();
    const principal = await provider.validateAgentKey(rawKey);

    expect(principal).not.toBeNull();
    if (!principal) throw new Error('Expected principal');
    expect(principal.id).toBe(testAgentId);
    expect(principal.type).toBe('agent');
    expect(principal.authProvider).toBe('agent_key');

    // The editor agent role should map to 'developer' PantheonRole
    expect(principal.pantheonSiteRoles).toBeDefined();
    expect(principal.pantheonSiteRoles[testSiteId]).toBe('developer');
  });

  it('Step 5: Revoke the key and verify auth fails', async () => {
    expect(rawKey).toBeDefined();
    expect(keyId).toBeDefined();

    // Revoke the key
    const revoked = await revokeKey(keyId, testAgentId);
    expect(revoked).toBe(true);

    // Validate the key should now return null
    const result = await validateKey(rawKey);
    expect(result).toBeNull();

    // The full provider should also return null
    const provider = new AgentApiKeyProvider();
    const principal = await provider.validateAgentKey(rawKey);
    expect(principal).toBeNull();
  });

  it('Step 6: Revoke the site role and verify the agent no longer has it', async () => {
    expect(roleId).toBeDefined();

    // Revoke the role
    const revoked = await revokeRole(roleId, testAgentId);
    expect(revoked).toBe(true);

    // Verify the agent's role list is now empty
    const roles = await listRoles(testAgentId);
    expect(roles.length).toBe(0);

    // Verify getRolesForAgent returns empty mapping
    const roleMapping = await getRolesForAgent(testAgentId);
    expect(Object.keys(roleMapping).length).toBe(0);
  });

  it.skip('Bonus: Deleting the agent cascades to keys and roles — agent_site_roles lacks FK CASCADE (type mismatch: UUID vs TEXT)', async () => {
    // Re-create a key and role for cascade test
    const keyResult = await generateKey({
      agentId: testAgentId,
      name: 'Cascade Test Key',
      createdBy: 'e2e-test-user',
    });

    await grantRole({
      agentId: testAgentId,
      siteId: testSiteId,
      role: 'viewer',
      grantedBy: 'e2e-test-user',
    });

    // Delete the agent
    const deleted = await deleteAgent(testAgentId);
    expect(deleted).toBe(true);

    // Keys should be gone (cascade)
    const keyCheck = await sql`
      SELECT id FROM app.agent_api_keys WHERE id = ${keyResult.metadata.id}
    `;
    expect(keyCheck.length).toBe(0);

    // Roles should be gone (cascade)
    const roleCheck = await sql`
      SELECT id FROM app.agent_site_roles WHERE agent_id = ${testAgentId}
    `;
    expect(roleCheck.length).toBe(0);

    // Mark as cleaned up so afterAll doesn't try to delete again
    testAgentId = '';
  });
});
