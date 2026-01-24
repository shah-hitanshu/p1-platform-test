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
  await page.click('.nav-link >> text=Sites');
  await expect(page).toHaveURL('/sites');

  // Create site
  await page.click('.create-btn');
  await page.locator('.form-input').first().fill(siteName);
  await page.locator('.form-input').nth(1).fill(pantheonId);

  const responsePromise = page.waitForResponse(resp =>
    resp.url().includes('/api/sites') && resp.request().method() === 'POST'
  );
  await page.click('.submit-btn');
  await responsePromise;

  await expect(page.locator('.create-form')).not.toBeVisible({ timeout: 10000 });

  // Navigate to site detail
  const siteRow = page.locator(`tr:has-text("${siteName}")`);
  await siteRow.locator('.view-link').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);
}

// Helper to create a branch
async function createBranch(page: import('@playwright/test').Page, branchName: string, parentBranchName?: string) {
  await page.locator('.branches-section .create-btn').click();
  await page.locator('.branches-section .form-input').fill(branchName);

  if (parentBranchName) {
    await page.locator('.branches-section .form-select').selectOption({ label: parentBranchName });
  }

  await page.locator('.branches-section .submit-btn').click();
  await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });
}

// Helper to navigate to merge requests page
async function navigateToMergeRequests(page: import('@playwright/test').Page) {
  await page.locator('.merge-requests-link').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/);
}

test.describe('Merge Requests List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should display merge requests link on site detail page', async ({ page }) => {
    const siteName = uniqueName('MR Link Test');
    const pantheonId = uniqueName('mrlink');

    await createSiteAndNavigate(page, siteName, pantheonId);

    await expect(page.locator('.merge-requests-link')).toBeVisible();
    await expect(page.locator('.merge-requests-link')).toContainText('Merge Requests');
  });

  test('should navigate to merge requests page', async ({ page }) => {
    const siteName = uniqueName('MR Nav Test');
    const pantheonId = uniqueName('mrnav');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);

    await expect(page.locator('.page-title')).toContainText('Merge Requests');
  });

  test('should show empty state when no merge requests exist', async ({ page }) => {
    const siteName = uniqueName('MR Empty Test');
    const pantheonId = uniqueName('mrempty');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);

    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No merge requests found');
  });

  test('should display status filter tabs', async ({ page }) => {
    const siteName = uniqueName('MR Tabs Test');
    const pantheonId = uniqueName('mrtabs');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);

    const tabs = page.locator('.filter-tabs');
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

    const createBtn = page.locator('.create-btn');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toContainText('Create merge request');
  });
});

test.describe('Create Merge Request', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should navigate to create page', async ({ page }) => {
    const siteName = uniqueName('MR Create Nav');
    const pantheonId = uniqueName('mrcreatenav');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests\/new$/);
    await expect(page.locator('.page-title')).toContainText('Create Merge Request');
  });

  test('should display form with required fields', async ({ page }) => {
    const siteName = uniqueName('MR Form Fields');
    const pantheonId = uniqueName('mrformfields');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    // Check form fields exist
    await expect(page.locator('#sourceBranch')).toBeVisible();
    await expect(page.locator('#targetBranch')).toBeVisible();
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('#description')).toBeVisible();
  });

  test('should show validation error when source and target are same', async ({ page }) => {
    const siteName = uniqueName('MR Same Branch');
    const pantheonId = uniqueName('mrsamebranch');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Create a feature branch
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    // Select same branch for source and target
    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: branchName });
    await page.locator('#title').fill('Test MR');

    // Submit
    await page.locator('.submit-btn').click();

    // Should show validation error
    await expect(page.locator('.error-message')).toBeVisible();
    await expect(page.locator('.error-message')).toContainText('different');
  });

  test('should show validation error when title is empty', async ({ page }) => {
    const siteName = uniqueName('MR No Title');
    const pantheonId = uniqueName('mrnotitle');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    // Select branches but no title
    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });

    // Submit
    await page.locator('.submit-btn').click();

    // Should show validation error
    await expect(page.locator('.error-message')).toBeVisible();
    await expect(page.locator('.error-message')).toContainText('title');
  });

  test('should create merge request with valid inputs', async ({ page }) => {
    const siteName = uniqueName('MR Create Valid');
    const pantheonId = uniqueName('mrcreatevalid');
    const branchName = uniqueName('feature');
    const mrTitle = uniqueName('Test MR');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    // Fill form
    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.locator('#description').fill('This is a test merge request');

    // Submit
    await page.locator('.submit-btn').click();

    // Should redirect to detail page
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests\/[a-z0-9-]+$/);

    // Should show the MR title
    await expect(page.locator('.mr-title')).toContainText(mrTitle);
  });

  test('should cancel and return to list', async ({ page }) => {
    const siteName = uniqueName('MR Cancel');
    const pantheonId = uniqueName('mrcancel');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    // Click cancel
    await page.locator('.cancel-btn').click();

    // Should return to list
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/);
  });
});

test.describe('Merge Request Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
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
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.locator('.submit-btn').click();

    // Verify detail page content
    await expect(page.locator('.mr-title')).toContainText(mrTitle);
    await expect(page.locator('.status-badge')).toBeVisible();
    await expect(page.locator('.mr-branches')).toBeVisible();
    await expect(page.locator('.mr-metadata')).toBeVisible();
  });

  test('should show status badge with correct color for open MR', async ({ page }) => {
    const siteName = uniqueName('MR Status Open');
    const pantheonId = uniqueName('mrstatusopen');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Status Test');
    await page.locator('.submit-btn').click();

    const badge = page.locator('.status-badge');
    await expect(badge).toContainText('open');
    await expect(badge).toHaveClass(/status-open/);
  });

  test('should display actions for open MR', async ({ page }) => {
    const siteName = uniqueName('MR Actions Open');
    const pantheonId = uniqueName('mractionsopen');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Actions Test');
    await page.locator('.submit-btn').click();

    // Open MR should have Approve, Close, Delete actions
    await expect(page.locator('.action-approve')).toBeVisible();
    await expect(page.locator('.action-close')).toBeVisible();
    await expect(page.locator('.action-delete')).toBeVisible();
  });
});

test.describe('Merge Request Status Changes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should approve merge request', async ({ page }) => {
    const siteName = uniqueName('MR Approve');
    const pantheonId = uniqueName('mrapprove');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Approve Test');
    await page.locator('.submit-btn').click();

    // Click Approve
    await page.locator('.action-approve').click();

    // Wait for status to update
    await expect(page.locator('.status-badge')).toContainText('approved', { timeout: 10000 });
    await expect(page.locator('.status-badge')).toHaveClass(/status-approved/);
  });

  test('should close merge request', async ({ page }) => {
    const siteName = uniqueName('MR Close');
    const pantheonId = uniqueName('mrclose');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Close Test');
    await page.locator('.submit-btn').click();

    // Click Close
    await page.locator('.action-close').click();

    // Wait for status to update
    await expect(page.locator('.status-badge')).toContainText('closed', { timeout: 10000 });
  });

  test('should reopen closed merge request', async ({ page }) => {
    const siteName = uniqueName('MR Reopen');
    const pantheonId = uniqueName('mrreopen');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Reopen Test');
    await page.locator('.submit-btn').click();

    // Close first
    await page.locator('.action-close').click();
    await expect(page.locator('.status-badge')).toContainText('closed', { timeout: 10000 });

    // Wait for the reopen button to appear (indicates status change completed)
    await expect(page.locator('.action-reopen')).toBeVisible({ timeout: 5000 });

    // Then reopen
    await page.locator('.action-reopen').click();
    await expect(page.locator('.status-badge')).toContainText('open', { timeout: 10000 });
  });
});

test.describe('Merge Request Deletion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should open delete confirmation modal', async ({ page }) => {
    const siteName = uniqueName('MR Delete Modal');
    const pantheonId = uniqueName('mrdeletemodal');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Delete Modal Test');
    await page.locator('.submit-btn').click();

    // Click Delete
    await page.locator('.action-delete').click();

    // Modal should appear
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.modal-title')).toContainText('Delete merge request?');
  });

  test('should delete merge request when confirmation matches', async ({ page }) => {
    const siteName = uniqueName('MR Delete');
    const pantheonId = uniqueName('mrdelete');
    const branchName = uniqueName('feature');
    const mrTitle = uniqueName('Delete Me MR');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.locator('.submit-btn').click();

    // Click Delete
    await page.locator('.action-delete').click();

    // Confirm deletion
    await page.locator('.confirm-input').fill(mrTitle);
    await page.locator('.modal-content .delete-btn').click();

    // Should redirect to list
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/, { timeout: 10000 });

    // MR should not be in the list - either empty state or table without MR
    const table = page.locator('.merge-requests-table');
    const emptyState = page.locator('.empty-state');

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
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should display merge preview panel', async ({ page }) => {
    const siteName = uniqueName('MR Preview');
    const pantheonId = uniqueName('mrpreview');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill('Preview Test');
    await page.locator('.submit-btn').click();

    // Should show merge preview panel
    await expect(page.locator('.merge-preview-panel')).toBeVisible();
    await expect(page.locator('.preview-btn')).toBeVisible();
    await expect(page.locator('.preview-btn')).toContainText('Preview Merge');
  });
});

test.describe('Merge Request List View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
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
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.locator('.submit-btn').click();

    // Navigate back to list
    await page.locator('.breadcrumb >> text=Merge Requests').click();

    // Should see MR in list
    await expect(page.locator('.merge-requests-table')).toBeVisible();
    await expect(page.locator('.merge-requests-table')).toContainText(mrTitle);
  });

  test('should navigate to detail when clicking table row', async ({ page }) => {
    const siteName = uniqueName('MR Row Click');
    const pantheonId = uniqueName('mrrowclick');
    const branchName = uniqueName('feature');
    const mrTitle = uniqueName('Row Click MR');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, branchName);

    await navigateToMergeRequests(page);
    await page.locator('.create-btn').click();

    await page.locator('#sourceBranch').selectOption({ label: branchName });
    await page.locator('#targetBranch').selectOption({ label: 'main' });
    await page.locator('#title').fill(mrTitle);
    await page.locator('.submit-btn').click();

    // Navigate back to list
    await page.locator('.breadcrumb >> text=Merge Requests').click();

    // Click on the row
    await page.locator(`tr:has-text("${mrTitle}")`).click();

    // Should navigate to detail page
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests\/[a-z0-9-]+$/);
    await expect(page.locator('.mr-title')).toContainText(mrTitle);
  });
});
