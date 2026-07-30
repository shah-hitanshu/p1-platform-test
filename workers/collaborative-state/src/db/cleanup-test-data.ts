/**
 * Database Cleanup Script for Test Data
 *
 * Removes entries created by E2E tests by identifying them through naming patterns.
 * Test entries use names like: 'e2e-site-1737849382234' or 'feature-1737849382234-a1b2c'
 *
 * Pattern: {prefix}-{timestamp} or {prefix}-{timestamp}-{randomSuffix}
 * Where timestamp is a 13-digit Unix timestamp (Date.now())
 *
 * Usage:
 *   pnpm db:cleanup              # Dry run - show what would be deleted
 *   pnpm db:cleanup --execute    # Actually delete test data
 *   pnpm db:cleanup --all        # Delete ALL data (use with caution)
 */

import postgres from 'postgres';

// Database connection
const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

// Pattern to match test names: prefix-timestamp or prefix-timestamp-suffix
// Timestamp is 13 digits (milliseconds since epoch)
// PostgreSQL regex pattern: '^.+-[0-9]{13}(-[a-z0-9]{5})?$'
//
// Test user IDs from the E2E tests (LoginPage.tsx):
// - Alice: 11111111-1111-1111-1111-111111111111
// - Bob: 22222222-2222-2222-2222-222222222222

interface CleanupStats {
  sites: number;
  branches: number;
  documents: number;
  documentVersions: number;
  checkpoints: number;
  mergeRequests: number;
  approvalRequests: number;
  branchGrants: number;
  guestLinks: number;
  checkpointDocuments: number;
  checkpointDocumentMetadata: number;
  checkpointStructures: number;
  branchDocumentMetadata: number;
  branchStructureState: number;
  structureNodes: number;
  siteStructures: number;
}

interface Site {
  id: string;
  name: string;
}

/**
 * Find all sites that match test naming patterns
 */
async function findTestSites(
  sql: ReturnType<typeof postgres>,
): Promise<Site[]> {
  const result = await sql<Site[]>`
    SELECT id, name
    FROM app.sites
    WHERE name ~ '^.+-[0-9]{13}(-[a-z0-9]{5})?$'
    ORDER BY created_at DESC
  `;
  return result;
}

/**
 * Delete all data related to the specified sites
 * Deletion order respects foreign key constraints (leaf tables first)
 */
async function deleteTestData(
  sql: ReturnType<typeof postgres>,
  siteIds: string[],
  dryRun: boolean,
): Promise<CleanupStats> {
  if (siteIds.length === 0) {
    return {
      sites: 0,
      branches: 0,
      documents: 0,
      documentVersions: 0,
      checkpoints: 0,
      mergeRequests: 0,
      approvalRequests: 0,
      branchGrants: 0,
      guestLinks: 0,
      checkpointDocuments: 0,
      checkpointDocumentMetadata: 0,
      checkpointStructures: 0,
      branchDocumentMetadata: 0,
      branchStructureState: 0,
      structureNodes: 0,
      siteStructures: 0,
    };
  }

  const stats: CleanupStats = {
    sites: 0,
    branches: 0,
    documents: 0,
    documentVersions: 0,
    checkpoints: 0,
    mergeRequests: 0,
    approvalRequests: 0,
    branchGrants: 0,
    guestLinks: 0,
    checkpointDocuments: 0,
    checkpointDocumentMetadata: 0,
    checkpointStructures: 0,
    branchDocumentMetadata: 0,
    branchStructureState: 0,
    structureNodes: 0,
    siteStructures: 0,
  };

  // Get all branch IDs for these sites
  const branches = await sql<{ id: string }[]>`
    SELECT id FROM app.branches WHERE site_id = ANY(${siteIds})
  `;
  const branchIds = branches.map((b) => b.id);

  // Get all document IDs for these sites
  const documents = await sql<{ id: string }[]>`
    SELECT id FROM app.documents WHERE site_id = ANY(${siteIds})
  `;
  const documentIds = documents.map((d) => d.id);

  // Get all checkpoint IDs for these branches
  const checkpoints = await sql<{ id: string }[]>`
    SELECT id FROM app.checkpoints WHERE branch_id = ANY(${branchIds})
  `;
  const checkpointIds = checkpoints.map((c) => c.id);

  // Get all merge request IDs for these branches
  const mergeRequests = await sql<{ id: string }[]>`
    SELECT id FROM app.merge_requests
    WHERE source_branch_id = ANY(${branchIds}) OR target_branch_id = ANY(${branchIds})
  `;
  const mergeRequestIds = mergeRequests.map((mr) => mr.id);

  if (dryRun) {
    console.log('\n=== DRY RUN - No data will be deleted ===\n');
  }

  // Delete in FK order (leaf tables first)

  // 1. Approval requests (depends on merge_requests)
  if (mergeRequestIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.approval_requests
        WHERE merge_request_id = ANY(${mergeRequestIds})
      `;
      stats.approvalRequests = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.approval_requests
        WHERE merge_request_id = ANY(${mergeRequestIds})
      `;
      stats.approvalRequests = result.count;
    }
  }

  // 2. Merge requests (depends on branches)
  if (branchIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.merge_requests
        WHERE source_branch_id = ANY(${branchIds}) OR target_branch_id = ANY(${branchIds})
      `;
      stats.mergeRequests = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.merge_requests
        WHERE source_branch_id = ANY(${branchIds}) OR target_branch_id = ANY(${branchIds})
      `;
      stats.mergeRequests = result.count;
    }
  }

  // 3. Guest links (depends on branches)
  if (branchIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.guest_links
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.guestLinks = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.guest_links
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.guestLinks = result.count;
    }
  }

  // 4. Branch grants (depends on branches)
  if (branchIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.branch_grants
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.branchGrants = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.branch_grants
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.branchGrants = result.count;
    }
  }

  // 5. Checkpoint documents (depends on checkpoints and documents)
  if (checkpointIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.checkpoint_documents
        WHERE checkpoint_id = ANY(${checkpointIds})
      `;
      stats.checkpointDocuments = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.checkpoint_documents
        WHERE checkpoint_id = ANY(${checkpointIds})
      `;
      stats.checkpointDocuments = result.count;
    }
  }

  // 6. Checkpoint document metadata (depends on checkpoints and documents)
  if (checkpointIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.checkpoint_document_metadata
        WHERE checkpoint_id = ANY(${checkpointIds})
      `;
      stats.checkpointDocumentMetadata = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.checkpoint_document_metadata
        WHERE checkpoint_id = ANY(${checkpointIds})
      `;
      stats.checkpointDocumentMetadata = result.count;
    }
  }

  // 7. Checkpoint structures (depends on checkpoints)
  if (checkpointIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.checkpoint_structures
        WHERE checkpoint_id = ANY(${checkpointIds})
      `;
      stats.checkpointStructures = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.checkpoint_structures
        WHERE checkpoint_id = ANY(${checkpointIds})
      `;
      stats.checkpointStructures = result.count;
    }
  }

  // 8. Checkpoints (depends on branches)
  // First, null out source_checkpoint_id in branches to break the FK reference
  if (branchIds.length > 0 && !dryRun) {
    await sql`
      UPDATE app.branches SET source_checkpoint_id = NULL
      WHERE site_id = ANY(${siteIds})
    `;
  }

  if (branchIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.checkpoints
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.checkpoints = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.checkpoints
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.checkpoints = result.count;
    }
  }

  // 9. Branch document metadata (depends on branches and documents)
  if (branchIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.branch_document_metadata
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.branchDocumentMetadata = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.branch_document_metadata
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.branchDocumentMetadata = result.count;
    }
  }

  // 10. Branch structure state (depends on branches)
  if (branchIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.branch_structure_state
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.branchStructureState = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.branch_structure_state
        WHERE branch_id = ANY(${branchIds})
      `;
      stats.branchStructureState = result.count;
    }
  }

  // 11. Document versions (depends on documents)
  if (documentIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.document_versions
        WHERE document_id = ANY(${documentIds})
      `;
      stats.documentVersions = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.document_versions
        WHERE document_id = ANY(${documentIds})
      `;
      stats.documentVersions = result.count;
    }
  }

  // 12. Structure nodes (depends on site_structures)
  if (siteIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.structure_nodes sn
        JOIN app.site_structures ss ON sn.structure_id = ss.id
        WHERE ss.site_id = ANY(${siteIds})
      `;
      stats.structureNodes = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.structure_nodes
        WHERE structure_id IN (
          SELECT id FROM app.site_structures WHERE site_id = ANY(${siteIds})
        )
      `;
      stats.structureNodes = result.count;
    }
  }

  // 13. Site structures (depends on sites)
  if (siteIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.site_structures
        WHERE site_id = ANY(${siteIds})
      `;
      stats.siteStructures = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.site_structures
        WHERE site_id = ANY(${siteIds})
      `;
      stats.siteStructures = result.count;
    }
  }

  // 14. Documents (depends on sites)
  if (siteIds.length > 0) {
    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.documents
        WHERE site_id = ANY(${siteIds})
      `;
      stats.documents = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.documents
        WHERE site_id = ANY(${siteIds})
      `;
      stats.documents = result.count;
    }
  }

  // 15. Branches (depends on sites) - need to handle source_branch_id self-reference
  if (siteIds.length > 0) {
    // First, set source_branch_id to null for all branches being deleted
    if (!dryRun) {
      await sql`
        UPDATE app.branches SET source_branch_id = NULL
        WHERE site_id = ANY(${siteIds})
      `;
    }

    if (dryRun) {
      const count = await sql`
        SELECT COUNT(*) as count FROM app.branches
        WHERE site_id = ANY(${siteIds})
      `;
      stats.branches = Number(count[0]?.count ?? 0);
    } else {
      const result = await sql`
        DELETE FROM app.branches
        WHERE site_id = ANY(${siteIds})
      `;
      stats.branches = result.count;
    }
  }

  // 16. Sites (root table)
  if (siteIds.length > 0) {
    if (dryRun) {
      stats.sites = siteIds.length;
    } else {
      const result = await sql`
        DELETE FROM app.sites
        WHERE id = ANY(${siteIds})
      `;
      stats.sites = result.count;
    }
  }

  return stats;
}

/**
 * Print cleanup statistics
 */
function printStats(stats: CleanupStats, dryRun: boolean): void {
  const action = dryRun ? 'Would delete' : 'Deleted';
  const total =
    stats.sites +
    stats.branches +
    stats.documents +
    stats.documentVersions +
    stats.checkpoints +
    stats.mergeRequests +
    stats.approvalRequests +
    stats.branchGrants +
    stats.guestLinks +
    stats.checkpointDocuments +
    stats.checkpointDocumentMetadata +
    stats.checkpointStructures +
    stats.branchDocumentMetadata +
    stats.branchStructureState +
    stats.structureNodes +
    stats.siteStructures;

  console.log(`\n${action}:`);
  console.log(`  Sites:                      ${String(stats.sites)}`);
  console.log(`  Branches:                   ${String(stats.branches)}`);
  console.log(`  Documents:                  ${String(stats.documents)}`);
  console.log(`  Document versions:          ${String(stats.documentVersions)}`);
  console.log(`  Checkpoints:                ${String(stats.checkpoints)}`);
  console.log(`  Checkpoint documents:       ${String(stats.checkpointDocuments)}`);
  console.log(`  Checkpoint doc metadata:    ${String(stats.checkpointDocumentMetadata)}`);
  console.log(`  Checkpoint structures:      ${String(stats.checkpointStructures)}`);
  console.log(`  Merge requests:             ${String(stats.mergeRequests)}`);
  console.log(`  Approval requests:          ${String(stats.approvalRequests)}`);
  console.log(`  Branch grants:              ${String(stats.branchGrants)}`);
  console.log(`  Guest links:                ${String(stats.guestLinks)}`);
  console.log(`  Branch document metadata:   ${String(stats.branchDocumentMetadata)}`);
  console.log(`  Branch structure state:     ${String(stats.branchStructureState)}`);
  console.log(`  Structure nodes:            ${String(stats.structureNodes)}`);
  console.log(`  Site structures:            ${String(stats.siteStructures)}`);
  console.log('  ─────────────────────────────────');
  console.log(`  Total rows:                 ${String(total)}`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const deleteAll = args.includes('--all');
  const dryRun = !execute;

  console.log('Test Data Cleanup Script');
  console.log('========================\n');

  const sql = postgres(DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    if (deleteAll) {
      console.log('WARNING: --all flag detected. This will delete ALL sites.\n');

      if (dryRun) {
        console.log('Run with --execute --all to confirm deletion of ALL data.\n');
      }

      const allSites = await sql<Site[]>`
        SELECT id, name FROM app.sites ORDER BY created_at DESC
      `;

      console.log(`Found ${String(allSites.length)} total site(s):\n`);
      for (const site of allSites) {
        console.log(`  - ${site.name} (${site.id})`);
      }

      const siteIds = allSites.map((s) => s.id);
      const stats = await deleteTestData(sql, siteIds, dryRun);
      printStats(stats, dryRun);
    } else {
      // Find test sites by naming pattern
      const testSites = await findTestSites(sql);

      if (testSites.length === 0) {
        console.log('No test data found matching the pattern.');
        console.log('Test entries should match: {prefix}-{13-digit-timestamp}');
        return;
      }

      console.log(`Found ${String(testSites.length)} test site(s):\n`);
      for (const site of testSites) {
        console.log(`  - ${site.name} (${site.id})`);
      }

      const siteIds = testSites.map((s) => s.id);
      const stats = await deleteTestData(sql, siteIds, dryRun);
      printStats(stats, dryRun);

      if (dryRun) {
        console.log('\nThis was a dry run. Run with --execute to actually delete the data.');
      } else {
        console.log('\n✓ Test data cleanup complete.');
      }
    }
  } catch (error) {
    console.error('Cleanup error:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

// Export for programmatic use
export { findTestSites, deleteTestData };
export type { CleanupStats };

// Run if called directly
void main();
