/**
 * PCC-3457: OAuth-subject actor attribution in the DO→Postgres sync path
 *
 * WHY THESE TESTS EXIST (Rule 9 — encode intent, not just behavior):
 *
 * PR #201 admitted OAuth subjects (`auth0|pn-*`, `google-oauth2|*`) as realtime
 * actorIds, but every persistence entry point passes actorId straight into the
 * uuid `created_by_id` column. In production this made EVERY realtime edit by
 * an OAuth-subject user fail with:
 *
 *   PostgresError: invalid input syntax for type uuid: "auth0|pn-..."
 *
 * and — because the queue consumer fails the WHOLE batch — it also poisoned
 * unrelated payloads batched alongside. Customer data was silently lost while
 * the editor showed "Saved" (incident PCC-3464).
 *
 * The contract these tests pin down:
 *  1. UUID actorIds behave exactly as before (zero-risk passthrough).
 *  2. A user-type OAuth subject resolves to app.users.id via principal_id.
 *  3. Unknown subjects are JIT-provisioned when the payload carries the
 *     verified email (available at realtime connect), idempotently.
 *  4. A subject whose email matches a pre-provisioned user (principal_id NULL)
 *     links that row — admins can pre-create users — but NEVER hijacks a row
 *     already claimed by a different principal.
 *  5. An unresolvable actor skips ONLY its own payload (reported in
 *     result.unresolved); the rest of the batch persists. No more
 *     one-bad-actor-poisons-the-batch.
 *  6. Agent principals are never JIT-provisioned as users.
 *  7. The HTTP sync path (syncCrdtToPostgres, used by DO /flush) applies the
 *     same resolution.
 *
 * These run against real PostgreSQL because the failure mode IS a Postgres
 * uuid cast — mocked-query tests cannot catch it (see PCC-3462).
 *
 * Prerequisites: docker start css-postgres && migrations applied.
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

import { createSite } from '../../src/services/site-service';
import { getMainBranch } from '../../src/services/branch-service';
import { createDocument } from '../../src/services/document-service';
import {
  batchSyncToPostgres,
} from '../../src/services/document-version-service';
import type { BatchSyncPayload } from '../../src/services/document-version-service';
import { syncCrdtToPostgres } from '../../src/services/crdt-sync-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const RUN = `pcc3457-${String(Date.now())}`;

// Production-shaped principals (PCC-3462: fixtures must match what production
// actually emits — these mirror the log-verified shapes from the incident).
const UUID_ACTOR = '11111111-2222-3333-4444-555555555555';
const AUTH0_SUBJECT = `auth0|pn-${RUN}-e953`;
const AUTH0_SUBJECT_2 = `auth0|pn-${RUN}-6c2f`;
const AUTH0_SUBJECT_3 = `auth0|pn-${RUN}-9999`;
const GOOGLE_SUBJECT = `google-oauth2|${RUN}1014943591`;
const AGENT_NON_UUID = `agent|${RUN}-not-a-uuid`;

let sql: postgres.Sql;
let siteId: string;
let branchId: string;
const docIds: string[] = [];
let docCounter = 0;

function realConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const client = postgres(connectionString, {
    transform: { undefined: null },
    max: 1,
  });
  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await client.unsafe<T[]>(
        sqlQuery,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );
      const rows = [...result] as T[];
      const withCount = result as unknown as { count?: number };
      return { rows, rowCount: withCount.count ?? rows.length };
    },
  };
  return { connection, sql: client };
}

/** Each test gets fresh documents so snapshot-dedup never interferes. */
async function freshDoc(): Promise<string> {
  docCounter += 1;
  const doc = await createDocument({
    siteId,
    path: `${RUN}/doc-${String(docCounter)}`,
  });
  docIds.push(doc.id);
  return doc.id;
}

function payload(
  documentId: string,
  actorId: string,
  overrides: Partial<BatchSyncPayload> = {},
): BatchSyncPayload {
  return {
    documentId,
    branchId,
    snapshot: { root: { title: `snap-${actorId}-${String(Date.now())}` } },
    actorId,
    actorType: 'user',
    ...overrides,
  };
}

async function userByPrincipal(principalId: string): Promise<
  { id: string; email: string; name: string | null; auth_provider: string | null } | undefined
> {
  const rows = await sql<
    { id: string; email: string; name: string | null; auth_provider: string | null }[]
  >`SELECT id, email, name, auth_provider FROM app.users WHERE principal_id = ${principalId}`;
  return rows[0];
}

async function versionCreator(documentId: string): Promise<string | undefined> {
  const rows = await sql<{ created_by_id: string }[]>`
    SELECT created_by_id FROM app.document_versions
    WHERE document_id = ${documentId} ORDER BY version_number DESC LIMIT 1`;
  return rows[0]?.created_by_id;
}

beforeAll(async () => {
  const { connection, sql: client } = realConnection(CONNECTION_STRING);
  sql = client;
  setDatabaseInstance(connection);

  const site = await createSite({
    pantheonSiteId: `${RUN}-site`,
    name: `${RUN}-site`,
  });
  siteId = site.id;
  const main = await getMainBranch(siteId);
  if (main === null) throw new Error('main branch missing for test site');
  branchId = main.id;
});

afterAll(async () => {
  // Dependency-ordered cleanup of everything this run created — including the
  // root document + version + publish checkpoint that createSite auto-seeds,
  // which the original cleanup missed (FK error on the site delete).
  await sql`DELETE FROM app.checkpoint_documents
            WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = ${branchId})`;
  await sql`DELETE FROM app.document_versions
            WHERE document_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})`;
  await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.checkpoints WHERE branch_id = ${branchId}`;
  await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
  await sql`DELETE FROM app.users WHERE principal_id LIKE ${'%' + RUN + '%'} OR email LIKE ${'%' + RUN + '%'}`;
  await sql.end();
});

describe('PCC-3457: batchSyncToPostgres actor resolution (queue path)', () => {
  it('passes UUID actorIds through unchanged (pre-incident behavior preserved)', async () => {
    const docId = await freshDoc();
    const result = await batchSyncToPostgres([payload(docId, UUID_ACTOR)]);

    expect(result.inserted).toHaveLength(1);
    expect(await versionCreator(docId)).toBe(UUID_ACTOR);
  });

  it('resolves an OAuth subject to an existing user via principal_id', async () => {
    // The one production principal that WAS provisioned (andrew@cellar-door.io
    // analog): a users row exists with matching principal_id.
    const email = `existing-${RUN}@example.test`;
    const [existing] = await sql<{ id: string }[]>`
      INSERT INTO app.users (email, name, principal_id, auth_provider)
      VALUES (${email}, 'Existing User', ${AUTH0_SUBJECT}, 'auth0')
      RETURNING id`;

    const docId = await freshDoc();
    const result = await batchSyncToPostgres([payload(docId, AUTH0_SUBJECT)]);

    expect(result.inserted).toHaveLength(1);
    expect(await versionCreator(docId)).toBe(existing.id);
  });

  it('JIT-provisions an unknown OAuth subject when the payload carries the verified email — idempotently', async () => {
    const email = `danny-${RUN}@example.test`;
    const docId = await freshDoc();

    const result = await batchSyncToPostgres([
      payload(docId, AUTH0_SUBJECT_2, {
        actorEmail: email,
        actorName: 'Danny Test',
      }),
    ]);

    expect(result.inserted).toHaveLength(1);
    const user = await userByPrincipal(AUTH0_SUBJECT_2);
    expect(user).toBeDefined();
    expect(user?.email).toBe(email);
    expect(user?.name).toBe('Danny Test');
    expect(user?.auth_provider).toBe('auth0');
    expect(await versionCreator(docId)).toBe(user?.id);

    // Second sync by the same subject must reuse the row, not duplicate it.
    const docId2 = await freshDoc();
    await batchSyncToPostgres([
      payload(docId2, AUTH0_SUBJECT_2, {
        actorEmail: email,
        actorName: 'Danny Test',
      }),
    ]);
    const count = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n FROM app.users WHERE principal_id = ${AUTH0_SUBJECT_2}`;
    expect(Number(count[0].n)).toBe(1);
    expect(await versionCreator(docId2)).toBe(user?.id);
  });

  it('derives auth_provider from the subject prefix for google-oauth2 principals', async () => {
    const docId = await freshDoc();
    await batchSyncToPostgres([
      payload(docId, GOOGLE_SUBJECT, {
        actorEmail: `google-${RUN}@example.test`,
        actorName: 'Google Person',
      }),
    ]);
    const user = await userByPrincipal(GOOGLE_SUBJECT);
    expect(user?.auth_provider).toBe('google-oauth2');
  });

  it('links a pre-provisioned user (principal_id NULL) by verified email instead of failing the unique email constraint', async () => {
    // Admin pre-created the user (users-api flow) but they never logged in:
    const email = `preprov-${RUN}@example.test`;
    const [pre] = await sql<{ id: string }[]>`
      INSERT INTO app.users (email, name) VALUES (${email}, 'Pre Provisioned')
      RETURNING id`;
    const subject = `auth0|pn-${RUN}-preprov`;

    const docId = await freshDoc();
    const result = await batchSyncToPostgres([
      payload(docId, subject, { actorEmail: email, actorName: 'Pre Provisioned' }),
    ]);

    expect(result.inserted).toHaveLength(1);
    expect(await versionCreator(docId)).toBe(pre.id);
    const linked = await sql<{ principal_id: string | null }[]>`
      SELECT principal_id FROM app.users WHERE id = ${pre.id}`;
    expect(linked[0].principal_id).toBe(subject);
  });

  it('links a pre-provisioned row even when the IdP email differs in case (review fix S2)', async () => {
    // Admins provision lowercase; IdPs may return mixed case. Without
    // normalization the JIT insert would create a duplicate row invisible
    // to the allowlist instead of linking the intended one.
    const email = `mixedcase-${RUN}@example.test`;
    const [pre] = await sql<{ id: string }[]>`
      INSERT INTO app.users (email, name) VALUES (${email}, 'Mixed Case')
      RETURNING id`;
    const subject = `auth0|pn-${RUN}-mixedcase`;

    const docId = await freshDoc();
    const result = await batchSyncToPostgres([
      payload(docId, subject, {
        actorEmail: `MixedCase-${RUN}@Example.TEST`,
        actorName: 'Mixed Case',
      }),
    ]);

    expect(result.inserted).toHaveLength(1);
    expect(await versionCreator(docId)).toBe(pre.id);
    const count = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n FROM app.users WHERE lower(email) = ${email}`;
    expect(Number(count[0].n)).toBe(1);
  });

  it('never hijacks a users row already claimed by a different principal', async () => {
    const email = `claimed-${RUN}@example.test`;
    const otherPrincipal = `auth0|pn-${RUN}-owner`;
    await sql`
      INSERT INTO app.users (email, name, principal_id, auth_provider)
      VALUES (${email}, 'Claimed User', ${otherPrincipal}, 'auth0')`;
    const intruder = `auth0|pn-${RUN}-intruder`;

    const docId = await freshDoc();
    const result = await batchSyncToPostgres([
      payload(docId, intruder, { actorEmail: email, actorName: 'Intruder' }),
    ]);

    // Payload is unresolved (skipped), not attributed to the claimed row.
    expect(result.inserted).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].actorId).toBe(intruder);
    expect(await versionCreator(docId)).toBeUndefined();
    const owner = await sql<{ principal_id: string | null }[]>`
      SELECT principal_id FROM app.users WHERE email = ${email}`;
    expect(owner[0].principal_id).toBe(otherPrincipal);
  });

  it('isolates an unresolvable actor to its own payload — the rest of the batch persists (no batch poisoning)', async () => {
    // THE incident behavior: one auth0 subject with no identity info failed the
    // uuid cast and took every other message in the batch down with it,
    // retry-looping forever. The contract: skip + report, never throw.
    const goodDoc = await freshDoc();
    const badDoc = await freshDoc();

    const result = await batchSyncToPostgres([
      payload(goodDoc, UUID_ACTOR),
      payload(badDoc, AUTH0_SUBJECT_3), // no users row, no actorEmail
    ]);

    expect(result.inserted).toHaveLength(1);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toMatchObject({
      documentId: badDoc,
      actorId: AUTH0_SUBJECT_3,
    });
    expect(await versionCreator(goodDoc)).toBe(UUID_ACTOR);
    expect(await versionCreator(badDoc)).toBeUndefined();
    // No user row invented without an email (email is NOT NULL by schema).
    expect(await userByPrincipal(AUTH0_SUBJECT_3)).toBeUndefined();
  });

  it('never JIT-provisions agent principals as users', async () => {
    const docId = await freshDoc();
    const result = await batchSyncToPostgres([
      payload(docId, AGENT_NON_UUID, {
        actorType: 'agent',
        actorEmail: `agent-${RUN}@example.test`,
      }),
    ]);

    expect(result.inserted).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(await userByPrincipal(AGENT_NON_UUID)).toBeUndefined();
  });
});

describe('PCC-3457: syncCrdtToPostgres actor resolution (HTTP path, used by DO /flush)', () => {
  it('resolves an OAuth subject with verified email on the single-payload HTTP path', async () => {
    const email = `flush-${RUN}@example.test`;
    const subject = `auth0|pn-${RUN}-flush`;
    const docId = await freshDoc();

    const version = await syncCrdtToPostgres({
      siteId,
      documentId: docId,
      branchId,
      snapshot: { root: { title: `flush-${RUN}` } },
      actorId: subject,
      actorType: 'user',
      actorEmail: email,
      actorName: 'Flush User',
    });

    const user = await userByPrincipal(subject);
    expect(user).toBeDefined();
    expect(version.createdById).toBe(user?.id);
  });
});
