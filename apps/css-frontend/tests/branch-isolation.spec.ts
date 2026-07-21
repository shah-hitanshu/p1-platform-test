/**
 * Branch Isolation E2E Tests
 *
 * Tests Git-like branch isolation for documents:
 * - Documents created on a branch are only visible on that branch
 * - New branches inherit documents from their parent
 * - Deleting a document on one branch doesn't affect other branches
 *
 * This test was created to prevent regression of the JSONB double-stringification bug
 * (commit e185646) where tombstone deletion wasn't filtering documents properly.
 */

import { test, expect, Page } from '@playwright/test';

// User IDs from LoginPage.tsx
const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Helper to generate unique names for test data
 */
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

/**
 * Helper to login as Alice
 */
async function loginAsAlice(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
  await page.getByTestId('login-button').click();
  await expect(page).toHaveURL('/');
}

test.describe('Branch Isolation', () => {
  // These tests involve multiple API calls, so increase timeout
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAsAlice(page);
  });

  /**
   * SKIP REASON: This test is flaky due to postgres.js cross-request I/O errors in Cloudflare Workers.
   *
   * The postgres.js library creates database connections that can persist across request contexts.
   * When a connection's internal state (like ReadyForQuery messages from PostgreSQL) resolves after
   * the original request has completed, it triggers errors like:
   * - "Cannot perform I/O on behalf of a different request"
   * - "A promise was resolved or rejected from a different request context"
   *
   * This is a limitation of Cloudflare Workers' request context isolation.
   *
   * TO FIX: Consider using Cloudflare Hyperdrive for proper connection pooling:
   * https://developers.cloudflare.com/hyperdrive/
   *
   * When the test passes (which it does intermittently), it validates:
   * - Documents created on a branch are only visible on that branch
   * - New branches inherit documents from their parent
   * - Deleting a document on one branch doesn't affect other branches
   *
   * Run manually with: npx playwright test branch-isolation.spec.ts
   */
  test.skip('full branch isolation workflow', async ({ page }) => {
    // =========================================================================
    // Step 1: Create a new site
    // =========================================================================
    const siteName = uniqueName('e2e-isolation');

    await page.goto('/sites');
    await page.getByTestId('create-site-btn').click();
    await expect(page.getByTestId('create-form')).toBeVisible();

    await page.fill('input[placeholder="Enter site name..."]', siteName);
    const pantheonId = siteName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    await page.fill('input[placeholder="Enter Pantheon Site ID..."]', pantheonId);
    await page.getByTestId('submit-site-btn').click();

    // Wait for site to appear and navigate to it
    await expect(page.locator(`text=${siteName}`)).toBeVisible({ timeout: 15000 });
    await page.locator(`tr:has-text("${siteName}")`).locator('a:has-text("View")').click();
    await page.waitForURL(/\/sites\/[a-f0-9-]+$/);

    const siteId = page.url().split('/sites/')[1];
    console.log(`Created site: ${siteName} (${siteId})`);

    // =========================================================================
    // Step 2: Get main branch ID and navigate to it
    // =========================================================================
    const mainRow = page.locator('tr:has-text("main")');
    await expect(mainRow).toBeVisible();
    const mainViewLink = mainRow.locator('a:has-text("View")');
    const mainHref = await mainViewLink.getAttribute('href');
    const mainBranchId = mainHref?.split('/branches/')[1] || '';
    console.log(`Main branch ID: ${mainBranchId}`);

    await mainViewLink.click();
    await page.waitForURL(/\/branches\//);

    // =========================================================================
    // Step 3: Create a document on main
    // =========================================================================
    await page.click('button:has-text("Documents")');
    await page.waitForTimeout(500);

    const mainDocPath = uniqueName('main-doc');
    await page.click('button:has-text("+ Create Document")');
    await page.fill('input[placeholder*="Document path"]', mainDocPath);
    await page.click('button:has-text("Create"):not(:has-text("+"))');

    // Wait for document to appear
    await expect(page.locator(`code:has-text("${mainDocPath}")`)).toBeVisible({ timeout: 10000 });
    console.log(`Created document on main: ${mainDocPath}`);

    // Verify main has 1 document
    await expect(page.locator('button:has-text("Documents (1)")')).toBeVisible({ timeout: 5000 });

    // =========================================================================
    // Step 4: Create a feature branch from main
    // =========================================================================
    await page.goto(`/sites/${siteId}`);
    await page.click('button:has-text("+ Create Branch")');

    const branchName = uniqueName('feature');
    await page.fill('input[placeholder*="branch name"]', branchName);
    await page.selectOption('select', { label: 'main' });
    await page.click('button:has-text("Create"):not(:has-text("+"))');

    // Wait for branch to appear
    await expect(page.locator(`text=${branchName}`)).toBeVisible({ timeout: 15000 });
    console.log(`Created branch: ${branchName}`);

    // Navigate to feature branch
    const branchRow = page.locator(`tr:has-text("${branchName}")`);
    await branchRow.locator('a:has-text("View")').click();
    await page.waitForURL(/\/branches\//);

    const featureBranchId = page.url().split('/branches/')[1];
    console.log(`Feature branch ID: ${featureBranchId}`);

    // =========================================================================
    // Step 5: Verify feature branch inherited the document
    // =========================================================================
    // Wait for page to stabilize before interacting
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Documents")');

    // Feature branch should have 1 document (inherited from main)
    // Wait for the Documents button to show the count (indicates data loaded)
    await expect(page.locator('button:has-text("Documents (1)")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`code:has-text("${mainDocPath}")`)).toBeVisible();
    console.log('Verified: Document inherited from main');

    // =========================================================================
    // Step 6: Create a document only on feature branch
    // =========================================================================
    const branchDocPath = uniqueName('branch-doc');
    await page.click('button:has-text("+ Create Document")');
    await page.fill('input[placeholder*="Document path"]', branchDocPath);
    await page.click('button:has-text("Create"):not(:has-text("+"))');

    // Wait for document to appear
    await expect(page.locator(`code:has-text("${branchDocPath}")`)).toBeVisible({ timeout: 10000 });
    console.log(`Created document on feature branch: ${branchDocPath}`);

    // Feature branch should now have 2 documents
    await expect(page.locator('button:has-text("Documents (2)")')).toBeVisible({ timeout: 5000 });

    // =========================================================================
    // Step 7: Verify main still has only 1 document
    // =========================================================================
    await page.goto(`/sites/${siteId}/branches/${mainBranchId}`);
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Documents")');

    // Main should still have only 1 document
    // Wait for the Documents button to show the count
    await expect(page.locator('button:has-text("Documents (1)")')).toBeVisible({ timeout: 15000 });

    // The branch-only document should NOT be visible on main
    await expect(page.locator(`code:has-text("${branchDocPath}")`)).not.toBeVisible();
    console.log('Verified: Branch-only document NOT visible on main');

    // =========================================================================
    // Step 8: Delete the document on main
    // =========================================================================
    // Set up dialog handler
    page.on('dialog', async dialog => {
      console.log(`Dialog: ${dialog.message()}`);
      await dialog.accept();
    });

    const docRow = page.locator(`tr:has-text("${mainDocPath}")`);
    await docRow.locator('button:has-text("Delete")').click();

    // Wait for deletion to complete
    await page.waitForTimeout(2000);

    // Verify main now has 0 documents
    await expect(page.locator('button:has-text("Documents (0)")')).toBeVisible({ timeout: 10000 });
    console.log('Verified: Document deleted from main');

    // =========================================================================
    // Step 9: Verify feature branch still has both documents
    // =========================================================================
    await page.goto(`/sites/${siteId}/branches/${featureBranchId}`);
    await page.waitForTimeout(1000);
    // Click Checkpoints first to ensure we switch tabs, then Documents
    await page.click('button:has-text("Checkpoints")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Documents")');

    // Wait for documents to load by checking for the document count in the button
    await expect(page.locator('button:has-text("Documents (2)")')).toBeVisible({ timeout: 15000 });

    // Both documents should be visible on feature branch
    await expect(page.locator(`code:has-text("${mainDocPath}")`)).toBeVisible();
    await expect(page.locator(`code:has-text("${branchDocPath}")`)).toBeVisible();
    console.log('Verified: Feature branch still has both documents (deletion on main did not affect it)');

    // =========================================================================
    // SUCCESS: Branch isolation is working correctly
    // =========================================================================
    console.log('=== BRANCH ISOLATION TEST PASSED ===');
  });
});
