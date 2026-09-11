/**
 * Development / CI seed loader.
 *
 * Applies the demo rows from the fixture modules. NOT for production: this
 * loads demo sites, mock users, and sample content used by local development
 * and the DB test suite.
 *
 * Usage:
 *   pnpm db:seed
 *
 * Run after migrations. Ids other than the pinned ones are generated per run, so
 * a second pass would orphan the rows that reference them; a database that
 * already carries the seed is left alone instead.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createSqlConnection } from './connection';
import * as content from './fixtures/content';
import { MOCK_ORG } from './fixtures/ids';
import * as sites from './fixtures/sites';
import * as schema from './schema';

async function main(): Promise<void> {
  const sql = createSqlConnection();
  const db = drizzle(sql);

  try {
    const seeded = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, MOCK_ORG))
      .limit(1);
    if (seeded.length > 0) {
      console.log('Database already seeded; leaving it as it is.');
      return;
    }

    console.log('Seeding database...');

    await db.transaction(async (tx) => {
      await tx.insert(schema.users).values(sites.users);
      await tx.insert(schema.organizations).values(sites.organizations);
      await tx.insert(schema.organizationMembers).values(sites.organizationMembers);
      await tx.insert(schema.agents).values(sites.agents);
      await tx.insert(schema.sites).values(sites.sites);
      await tx.insert(schema.userSiteRoles).values(sites.userSiteRoles);
      await tx.insert(schema.agentSiteRoles).values(sites.agentSiteRoles);
      await tx.insert(schema.branches).values(content.branches);
      await tx.insert(schema.documents).values(content.documents);
      await tx.insert(schema.siteStructures).values(content.siteStructures);
      await tx.insert(schema.documentVersions).values(content.documentVersions);
      await tx.insert(schema.checkpoints).values(content.checkpoints);
      await tx.insert(schema.checkpointDocuments).values(content.checkpointDocuments);
      await tx.insert(schema.structureNodes).values(content.structureNodes);
      await tx.insert(schema.branchStructureState).values(content.branchStructureState);
      await tx.insert(schema.branchDocumentMetadata).values(content.branchDocumentMetadata);
    });

    console.log('✓ Seed data applied.');
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

void main();
