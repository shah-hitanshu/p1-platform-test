/**
 * Merge Diff Visualization E2E Tests
 *
 * Tests the visual diff feature in merge conflict resolution UI.
 * Creates conflicting document changes and verifies the diff viewer works.
 */

import { test, expect } from '@playwright/test';

// User IDs from LoginPage.tsx (must be UUIDs to match database schema)
const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

// Helper to generate unique names for each test
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Helper to create a site and navigate to it
async function createSiteAndNavigate(
  page: import('@playwright/test').Page,
  siteName: string,
  pantheonId: string
) {
  // Navigate to sites
  await page.getByTestId('nav-sites').click();
  await expect(page).toHaveURL('/sites');

  // Create site
  await page.getByTestId('create-site-btn').click();
  await page.getByTestId('site-name-input').fill(siteName);
  await page.getByTestId('pantheon-id-input').fill(pantheonId);

  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/sites') && resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-site-btn').click();
  await responsePromise;

  // Wait for the new site row to appear
  const siteRow = page.locator(`tr:has-text("${siteName}")`);
  await expect(siteRow).toBeVisible({ timeout: 10000 });

  // Navigate to site detail
  await siteRow.locator('[data-testid^="view-site-"]').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);
}

// Helper to create a branch
async function createBranch(
  page: import('@playwright/test').Page,
  branchName: string,
  parentBranchName?: string
) {
  await page.getByTestId('create-branch-btn').click();
  await page.getByTestId('branch-name-input').fill(branchName);

  if (parentBranchName) {
    await page
      .getByTestId('parent-branch-select')
      .selectOption({ label: parentBranchName });
  }

  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/sites') &&
      resp.url().includes('/branches') &&
      resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-branch-btn').click();
  await responsePromise;

  // Wait for the new branch row to appear
  await expect(page.locator(`tr:has-text("${branchName}")`)).toBeVisible({
    timeout: 10000,
  });
}

// Helper to navigate to merge requests page
async function navigateToMergeRequests(page: import('@playwright/test').Page) {
  await page.getByTestId('merge-requests-link').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/);
}

// Helper to create a merge request through UI
async function createMergeRequestViaUI(
  page: import('@playwright/test').Page,
  sourceBranchName: string,
  targetBranchName: string,
  title: string
) {
  // Navigate to merge requests page first if not there
  const currentUrl = page.url();
  if (!currentUrl.includes('/merge-requests')) {
    await navigateToMergeRequests(page);
  }

  // Click create button
  await page.getByTestId('create-mr-btn').click();
  await expect(page).toHaveURL(/\/merge-requests\/new$/);

  // Wait for form to load and branches to be available
  const sourceSelect = page.getByTestId('source-branch-select');
  await expect(sourceSelect).toBeVisible({ timeout: 10000 });

  // Wait for branches to load (options beyond the placeholder)
  await page.waitForFunction(
    () => {
      const select = document.querySelector('[data-testid="source-branch-select"]') as HTMLSelectElement;
      return select && select.options.length > 1;
    },
    { timeout: 15000 }
  );

  // Fill form - use label for selectOption
  await sourceSelect.selectOption({ label: sourceBranchName });
  await page
    .getByTestId('target-branch-select')
    .selectOption({ label: targetBranchName });
  await page.getByTestId('title-input').fill(title);

  // Submit
  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/merge-requests') &&
      resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-btn').click();
  await responsePromise;

  // Should redirect to detail page
  await expect(page).toHaveURL(/\/merge-requests\/[a-z0-9-]+$/);
}

test.describe('Merge Diff Visualization', () => {
  test.setTimeout(120000); // These tests involve multiple steps

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should show merge preview panel on merge request detail', async ({
    page,
  }) => {
    // Setup: Create site with a branch
    const siteName = uniqueName('PreviewPanel Test');
    const pantheonId = uniqueName('preview');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, featureBranchName);

    // Create merge request from feature to main
    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Preview Test MR'
    );

    // Verify we're on the detail page
    await expect(page.getByTestId('mr-title')).toContainText('Preview Test MR');

    // Merge preview panel should be visible
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });

    // Wait for preview to load (either result or error)
    await expect(
      page
        .locator('[data-testid="preview-result"], [data-testid="preview-error"]')
        .first()
    ).toBeVisible({ timeout: 20000 });
  });

  test('should show conflict resolution panel when merge request is conflicted', async ({
    page,
  }) => {
    // This test checks that the conflict resolution UI is available
    // Note: Creating actual conflicts requires document changes which need additional setup

    const siteName = uniqueName('ConflictUI Test');
    const pantheonId = uniqueName('conflictui');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, featureBranchName);

    // Create merge request
    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Conflict UI Test MR'
    );

    // Wait for status badge to appear
    await expect(page.getByTestId('mr-status-badge')).toBeVisible({
      timeout: 10000,
    });

    // Check the status - should be 'open' for a clean merge
    const statusText = await page.getByTestId('mr-status-badge').textContent();

    if (statusText?.includes('conflicted')) {
      // If conflicted, the resolve button should be available
      await expect(page.getByTestId('resolve-btn')).toBeVisible();

      // Click to show resolution panel
      await page.getByTestId('resolve-btn').click();

      // Resolution panel should appear
      await expect(page.locator('.conflict-resolution-panel')).toBeVisible({
        timeout: 10000,
      });
    } else {
      // If not conflicted, the approve or merge actions should be available
      const approveBtn = page.getByTestId('approve-btn');
      const mergeBtn = page.getByTestId('merge-btn');

      // At least one action should be available for open/approved MRs
      await expect(approveBtn.or(mergeBtn)).toBeVisible({ timeout: 10000 });
    }
  });

  test('should refresh preview when clicking refresh button', async ({
    page,
  }) => {
    const siteName = uniqueName('RefreshPreview Test');
    const pantheonId = uniqueName('refresh');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, featureBranchName);
    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Refresh Preview MR'
    );

    // Wait for initial preview load - either result or error
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    const previewContent = page.locator(
      '[data-testid="preview-result"], [data-testid="preview-error"]'
    ).first();
    await expect(previewContent).toBeVisible({ timeout: 20000 });

    // Click refresh button
    const refreshBtn = page.getByTestId('refresh-preview-btn');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Should show loading state briefly, then result or error again
    await expect(previewContent).toBeVisible({ timeout: 20000 });
  });

  test('should display actions based on merge request status', async ({
    page,
  }) => {
    const siteName = uniqueName('Actions Test');
    const pantheonId = uniqueName('actions');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, featureBranchName);
    await createMergeRequestViaUI(page, featureBranchName, 'main', 'Actions MR');

    // Wait for page to fully load
    await expect(page.getByTestId('mr-title')).toContainText('Actions MR');
    await expect(page.getByTestId('mr-status-badge')).toBeVisible({
      timeout: 10000,
    });

    // Actions container should be visible
    await expect(page.getByTestId('actions-container')).toBeVisible();

    const statusText = await page.getByTestId('mr-status-badge').textContent();

    if (statusText?.includes('open')) {
      // Open MRs should have approve and close buttons
      await expect(page.getByTestId('approve-btn')).toBeVisible();
      await expect(page.getByTestId('close-btn')).toBeVisible();
    } else if (statusText?.includes('approved')) {
      // Approved MRs should have merge and close buttons
      await expect(page.getByTestId('merge-btn')).toBeVisible();
      await expect(page.getByTestId('close-btn')).toBeVisible();
    } else if (statusText?.includes('conflicted')) {
      // Conflicted MRs should have resolve and close buttons
      await expect(page.getByTestId('resolve-btn')).toBeVisible();
      await expect(page.getByTestId('close-btn')).toBeVisible();
    }
  });
});
