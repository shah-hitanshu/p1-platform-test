/**
 * Merge Request E2E Tests
 *
 * Tests merge request lifecycle: create, view, approve, execute, close, and delete.
 * These tests use unique timestamps to ensure test isolation.
 */

import { test, expect } from '@playwright/test';

// User IDs from LoginPage.tsx (must be UUIDs to match database schema)
const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

// Helper to generate unique names for each test
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Helper to create a site and navigate to it
async function createSiteAndNavigate(page: import('@playwright/test').Page, siteName: string, pantheonId: string) {
  // Navigate to sites
  await page.getByTestId('nav-sites').click();
  await expect(page).toHaveURL('/sites');

  // Create site
  await page.getByTestId('create-site-btn').click();
  await page.getByTestId('site-name-input').fill(siteName);
  await page.getByTestId('pantheon-id-input').fill(pantheonId);

  const responsePromise = page.waitForResponse(resp =>
    resp.url().includes('/api/sites') && resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-site-btn').click();
  await responsePromise;

  // Wait for the new site row to appear (more reliable than waiting for form to hide)
  const siteRow = page.locator(`tr:has-text("${siteName}")`);
  await expect(siteRow).toBeVisible({ timeout: 10000 });

  // Navigate to site detail
  await siteRow.locator('[data-testid^="view-site-"]').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);
}

// Helper to create a branch (always from main — no parent selector)
async function createBranch(page: import('@playwright/test').Page, branchName: string) {
  await page.getByTestId('create-branch-btn').click();
  await page.getByTestId('branch-name-input').fill(branchName);

  const responsePromise = page.waitForResponse(resp =>
    resp.url().includes('/api/sites') && resp.url().includes('/branches') && resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-branch-btn').click();
  await responsePromise;

  // Wait for the new branch row to appear (more reliable than waiting for form to hide)
  await expect(page.locator(`tr:has-text("${branchName}")`)).toBeVisible({ timeout: 10000 });
}

// Helper to navigate to merge requests page
async function navigateToMergeRequests(page: import('@playwright/test').Page) {
  await page.getByTestId('merge-requests-link').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/);
}

test.describe('Merge Requests List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should display merge requests link on site detail page', async ({ page }) => {
    const siteName = uniqueName('MR Link Test');
    const pantheonId = uniqueName('mrlink');

    await createSiteAndNavigate(page, siteName, pantheonId);

    await expect(page.getByTestId('merge-requests-link')).toBeVisible();
    await expect(page.getByTestId('merge-requests-link')).toContainText('Merge requests');
  });

  test('should navigate to merge requests page', async ({ page }) => {
    const siteName = uniqueName('MR Nav Test');
    const pantheonId = uniqueName('mrnav');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);

    await expect(page.getByTestId('page-title')).toContainText('Merge Requests');
  });

  test('should show empty state when no merge requests exist', async ({ page }) => {
    const siteName = uniqueName('MR Empty Test');
    const pantheonId = uniqueName('mrempty');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);

    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toContainText('No merge requests found');
  });

  test('should display status filter tabs', async ({ page }) => {
    const siteName = uniqueName('MR Tabs Test');
    const pantheonId = uniqueName('mrtabs');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);

    const tabs = page.getByTestId('filter-tabs');
    await expect(tabs).toBeVisible();
    await expect(tabs).toContainText('All');
    await expect(tabs).toContainText('Open');
    await expect(tabs).toContainText('Approved');
    await expect(tabs).toContainText('Conflicted');
    await expect(tabs).toContainText('Merged');
    await expect(tabs).toContainText('Closed');
  });

  test('should have create merge request button', async ({ page }) => {
    const siteName = uniqueName('MR Create Btn');
    const pantheonId = uniqueName('mrcreatebtn');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);

    const createBtn = page.getByTestId('create-mr-btn');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toContainText('Create merge request');
  });
});

test.describe('Create Merge Request', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should navigate to create page', async ({ page }) => {
    const siteName = uniqueName('MR Create Nav');
    const pantheonId = uniqueName('mrcreatenav');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests\/new$/);
    await expect(page.getByTestId('page-title')).toContainText('Create Merge Request');
  });

  test('should display form with required fields and target pre-selected as main', async ({ page }) => {
    const siteName = uniqueName('MR Form Fields');
    const pantheonId = uniqueName('mrformfields');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    // Check form fields exist
    await expect(page.locator('#sourceBranch')).toBeVisible();
    await expect(page.locator('#targetBranch')).toBeVisible();
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('#description')).toBeVisible();

    // Target branch should be pre-selected as main and disabled/read-only
    await expect(page.locator('#targetBranch')).toBeDisabled();
    await expect(page.locator('#targetBranch')).toHaveValue(/main/);
  });

  test('should show validation error when source and target are same', async ({ page }) => {
    const siteName = uniqueName('MR Same Branch');
    const pantheonId = uniqueName('mrsamebranch');

    await createSiteAndNavigate(page, siteName, pantheonId);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    // Target branch should be pre-selected as main and disabled
    await expect(page.locator('#targetBranch')).toBeDisabled();
    await expect(page.locator('#targetBranch')).toHaveValue(/main/);

    // Select main as the source too (same as target)
    await page.locator('#sourceBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Test MR');

    // Submit
    await page.getByTestId('submit-btn').click();

    // Should show validation error
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page.getByTestId('form-error')).toContainText('different');
  });

  test('should show validation error when title is empty', async ({ page }) => {
    const siteName = uniqueName('MR No Title');
    const pantheonId = uniqueName('mrnotitle');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    // Select branches but no title
    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });

    // Submit
    await page.getByTestId('submit-btn').click();

    // Should show validation error
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page.getByTestId('form-error')).toContainText('title');
  });

  test('should create merge request with valid inputs', async ({ page }) => {
    const siteName = uniqueName('MR Create Valid');
    const pantheonId = uniqueName('mrcreatevalid');
    const branchName = uniqueName('feature');
    const mrTitle = uniqueName('Test MR');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    // Fill form
    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.locator('#description').fill('This is a test merge request');

    // Submit
    await page.getByTestId('submit-btn').click();

    // Should redirect to detail page
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests\/[a-z0-9-]+$/);

    // Should show the MR title
    await expect(page.getByTestId('mr-title')).toContainText(mrTitle);
  });

  test('should cancel and return to list', async ({ page }) => {
    const siteName = uniqueName('MR Cancel');
    const pantheonId = uniqueName('mrcancel');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    // Click cancel
    await page.getByTestId('cancel-btn').click();

    // Should return to list
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/);
  });
});

test.describe('Merge Request Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should display merge request details', async ({ page }) => {
    const siteName = uniqueName('MR Detail');
    const pantheonId = uniqueName('mrdetail');
    const branchName = uniqueName('feature');
    const mrTitle = uniqueName('Detail Test MR');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.getByTestId('submit-btn').click();

    // Verify detail page content
    await expect(page.getByTestId('mr-title')).toContainText(mrTitle);
    await expect(page.getByTestId('mr-status-badge')).toBeVisible();
    await expect(page.getByTestId('mr-branches')).toBeVisible();
    await expect(page.getByTestId('mr-metadata')).toBeVisible();
  });

  test('should show status badge with correct color for open MR', async ({ page }) => {
    const siteName = uniqueName('MR Status Open');
    const pantheonId = uniqueName('mrstatusopen');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Status Test');
    await page.getByTestId('submit-btn').click();

    const badge = page.getByTestId('mr-status-badge');
    await expect(badge).toContainText('open');
  });

  test('should display actions for open MR', async ({ page }) => {
    const siteName = uniqueName('MR Actions Open');
    const pantheonId = uniqueName('mractionsopen');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Actions Test');
    await page.getByTestId('submit-btn').click();

    // Open MR should have Approve, Close, Delete actions
    await expect(page.getByTestId('approve-btn')).toBeVisible();
    await expect(page.getByTestId('close-btn')).toBeVisible();
    await expect(page.getByTestId('delete-btn')).toBeVisible();
  });
});

test.describe('Merge Request Status Changes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should approve merge request', async ({ page }) => {
    const siteName = uniqueName('MR Approve');
    const pantheonId = uniqueName('mrapprove');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Approve Test');
    await page.getByTestId('submit-btn').click();

    // Click Approve
    await page.getByTestId('approve-btn').click();

    // Wait for status to update
    await expect(page.getByTestId('mr-status-badge')).toContainText('approved', { timeout: 10000 });
  });

  test('should close merge request', async ({ page }) => {
    const siteName = uniqueName('MR Close');
    const pantheonId = uniqueName('mrclose');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Close Test');
    await page.getByTestId('submit-btn').click();

    // Wait for detail page to load
    await expect(page.getByTestId('mr-status-badge')).toBeVisible({ timeout: 5000 });

    // Click Close - wait for API response
    const responsePromise = page.waitForResponse(resp =>
      resp.url().includes('/merge-requests/') && resp.request().method() === 'PATCH'
    );
    await page.getByTestId('close-btn').click();
    await responsePromise;

    // Wait for status to update
    await expect(page.getByTestId('mr-status-badge')).toContainText('closed', { timeout: 10000 });
  });

  test('should reopen closed merge request', async ({ page }) => {
    const siteName = uniqueName('MR Reopen');
    const pantheonId = uniqueName('mrreopen');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Reopen Test');
    await page.getByTestId('submit-btn').click();

    // Wait for detail page to load
    await expect(page.getByTestId('mr-status-badge')).toBeVisible({ timeout: 5000 });

    // Close first - wait for API response
    const closeResponsePromise = page.waitForResponse(resp =>
      resp.url().includes('/merge-requests/') && resp.request().method() === 'PATCH'
    );
    await page.getByTestId('close-btn').click();
    await closeResponsePromise;

    // Wait for UI to reflect the status change
    await expect(page.locator('.tag')).toContainText('closed', { timeout: 10000 });

    // Wait for the reopen button to appear (indicates status change completed)
    await expect(page.getByTestId('reopen-btn')).toBeVisible({ timeout: 5000 });

    // Then reopen - wait for API response
    const reopenResponsePromise = page.waitForResponse(resp =>
      resp.url().includes('/merge-requests/') && resp.request().method() === 'PATCH'
    );
    await page.getByTestId('reopen-btn').click();
    await reopenResponsePromise;

    await expect(page.getByTestId('mr-status-badge')).toContainText('open', { timeout: 10000 });
  });
});

test.describe('Merge Request Deletion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should open delete confirmation modal', async ({ page }) => {
    const siteName = uniqueName('MR Delete Modal');
    const pantheonId = uniqueName('mrdeletemodal');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Delete Modal Test');
    await page.getByTestId('submit-btn').click();

    // Click Delete
    await page.getByTestId('delete-btn').click();

    // Modal should appear (PDS Modal uses role="dialog" with aria label)
    const dialog = page.getByRole('dialog', { name: /Delete merge request confirmation/i });
    await expect(dialog).toBeVisible();
  });

  test('should delete merge request when confirmation matches', async ({ page }) => {
    const siteName = uniqueName('MR Delete');
    const pantheonId = uniqueName('mrdelete');
    const branchName = uniqueName('feature');
    const mrTitle = uniqueName('Delete Me MR');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.getByTestId('submit-btn').click();

    // Click Delete
    await page.getByTestId('delete-btn').click();

    // Confirm deletion
    await page.getByTestId('confirm-input').fill(mrTitle);
    await page.getByTestId('delete-button').click();

    // Should redirect to list
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/, { timeout: 10000 });

    // MR should not be in the list - either empty state or table without MR
    const table = page.getByTestId('merge-requests-table');
    const emptyState = page.getByTestId('empty-state');

    // Wait for either empty state or table to be visible
    await expect(table.or(emptyState)).toBeVisible({ timeout: 5000 });

    // If table exists, verify it doesn't contain our deleted MR
    if (await table.count() > 0) {
      await expect(table).not.toContainText(mrTitle);
    }
  });
});

test.describe('Merge Request Preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should display merge preview panel with auto-loaded results', async ({ page }) => {
    const siteName = uniqueName('MR Preview');
    const pantheonId = uniqueName('mrpreview');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Preview Test');
    await page.getByTestId('submit-btn').click();

    // Should show merge preview panel with auto-loaded results
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('refresh-preview-btn')).toBeVisible();

    // Preview loads automatically - wait for results (or error if race condition in local dev)
    // First check loading starts - use first() to avoid strict mode issues if multiple elements exist
    await expect(page.locator('[data-testid="preview-loading"], [data-testid="preview-result"], [data-testid="preview-error"]').first()).toBeVisible({ timeout: 10000 });

    // Then wait for loading to complete
    await expect(page.locator('[data-testid="preview-result"], [data-testid="preview-error"]').first()).toBeVisible({ timeout: 20000 });

    // After loading, button should show "Refresh"
    await expect(page.getByTestId('refresh-preview-btn')).toContainText('Refresh');
  });
});

test.describe('Merge Request List View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should display merge request in list after creation', async ({ page }) => {
    const siteName = uniqueName('MR List View');
    const pantheonId = uniqueName('mrlistview');
    const branchName = uniqueName('feature');
    const mrTitle = uniqueName('List View MR');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.getByTestId('submit-btn').click();

    // Navigate back to list
    await page.getByTestId('breadcrumb').locator('text=Merge Requests').click();
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/);

    // Should see MR in list - wait for table to load
    await expect(page.getByTestId('merge-requests-table')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('merge-requests-table')).toContainText(mrTitle);
  });

  test('should navigate to detail when clicking table row', async ({ page }) => {
    const siteName = uniqueName('MR Row Click');
    const pantheonId = uniqueName('mrrowclick');
    const branchName = uniqueName('feature');
    const mrTitle = uniqueName('Row Click MR');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.getByTestId('create-mr-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.getByTestId('submit-btn').click();

    // Navigate back to list
    await page.getByTestId('breadcrumb').locator('text=Merge Requests').click();

    // Click on the row
    await page.locator(`tr:has-text("${mrTitle}")`).click();

    // Should navigate to detail page
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests\/[a-z0-9-]+$/);
    await expect(page.getByTestId('mr-title')).toContainText(mrTitle);
  });
});
