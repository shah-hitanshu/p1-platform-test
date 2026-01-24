/**
 * Branch CRUD E2E Tests
 *
 * Tests complete branch lifecycle: create, read, and delete operations.
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

  // Create site - wait for API response
  await page.click('.create-btn');
  await page.locator('.form-input').first().fill(siteName);
  await page.locator('.form-input').nth(1).fill(pantheonId);

  // Wait for API response before clicking submit
  const responsePromise = page.waitForResponse(resp =>
    resp.url().includes('/api/sites') && resp.request().method() === 'POST'
  );
  await page.click('.submit-btn');
  await responsePromise;

  // Wait for form to close
  await expect(page.locator('.create-form')).not.toBeVisible({ timeout: 10000 });

  // Navigate to site detail
  const siteRow = page.locator(`tr:has-text("${siteName}")`);
  await siteRow.locator('.view-link').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);
}

test.describe('Branch Creation', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should display branches section with main branch', async ({ page }) => {
    const siteName = uniqueName('Main Branch Test');
    const pantheonId = uniqueName('mainbranch');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Every site should have a main branch created automatically
    await expect(page.locator('.section-title')).toContainText('Branches');
    await expect(page.locator('.branches-table')).toBeVisible();
    await expect(page.locator('.branches-table')).toContainText('main');
  });

  test('should have create branch button', async ({ page }) => {
    const siteName = uniqueName('Create Btn Test');
    const pantheonId = uniqueName('createbtn');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const createBtn = page.locator('.branches-section .create-btn');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toContainText('Create branch');
  });

  test('should toggle create branch form', async ({ page }) => {
    const siteName = uniqueName('Toggle Form Test');
    const pantheonId = uniqueName('toggleform');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const createBtn = page.locator('.branches-section .create-btn');

    // Form should not be visible initially
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible();

    // Click to show form
    await createBtn.click();
    await expect(page.locator('.branches-section .create-form')).toBeVisible();

    // Button should change to Cancel
    await expect(createBtn).toContainText('Cancel');

    // Click to hide form
    await createBtn.click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible();
  });

  test('should create a new branch', async ({ page }) => {
    const siteName = uniqueName('New Branch Test');
    const pantheonId = uniqueName('newbranch');
    const branchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Open create form
    await page.locator('.branches-section .create-btn').click();

    // Fill branch name
    await page.locator('.branches-section .form-input').fill(branchName);

    // Submit
    await page.locator('.branches-section .submit-btn').click();

    // Wait for form to close
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Verify branch appears in table
    await expect(page.locator('.branches-table')).toContainText(branchName);
  });

  test('should create branch from parent branch', async ({ page }) => {
    const siteName = uniqueName('Parent Branch Test');
    const pantheonId = uniqueName('parentbranch');
    const parentBranchName = uniqueName('parent');
    const childBranchName = uniqueName('child');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // First create a parent branch
    await page.locator('.branches-section .create-btn').click();
    await page.locator('.branches-section .form-input').fill(parentBranchName);
    await page.locator('.branches-section .submit-btn').click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Now create a child branch from the parent
    await page.locator('.branches-section .create-btn').click();
    await page.locator('.branches-section .form-input').fill(childBranchName);

    // Select the parent branch
    await page.locator('.branches-section .form-select').selectOption({ label: parentBranchName });

    await page.locator('.branches-section .submit-btn').click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Verify child branch exists
    await expect(page.locator('.branches-table')).toContainText(childBranchName);
  });

  test('should not create branch with empty name', async ({ page }) => {
    const siteName = uniqueName('Empty Name Test');
    const pantheonId = uniqueName('emptyname');

    await createSiteAndNavigate(page, siteName, pantheonId);

    await page.locator('.branches-section .create-btn').click();

    // Submit button should be disabled when name is empty
    await expect(page.locator('.branches-section .submit-btn')).toBeDisabled();
  });
});

test.describe('Branch Deletion', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should not show delete button for main branch', async ({ page }) => {
    const siteName = uniqueName('No Delete Main');
    const pantheonId = uniqueName('nodeletemain');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Find the main branch row
    const mainRow = page.locator('tr:has-text("main")');
    await expect(mainRow).toBeVisible();

    // Main branch should NOT have a delete button
    await expect(mainRow.locator('.delete-link')).not.toBeVisible();
  });

  test('should open delete confirmation modal for non-main branch', async ({ page }) => {
    const siteName = uniqueName('Delete Modal Test');
    const pantheonId = uniqueName('deletemodal');
    const branchName = uniqueName('deletable');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Create a branch
    await page.locator('.branches-section .create-btn').click();
    await page.locator('.branches-section .form-input').fill(branchName);
    await page.locator('.branches-section .submit-btn').click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Find and click delete button
    const branchRow = page.locator(`tr:has-text("${branchName}")`);
    await expect(branchRow).toBeVisible();
    await branchRow.locator('.delete-link').click();

    // Modal should appear (PDS Modal uses role="dialog" with aria label)
    const dialog = page.getByRole('dialog', { name: /Delete branch confirmation/i });
    await expect(dialog).toBeVisible();
  });

  test('should require typing branch name to confirm deletion', async ({ page }) => {
    const siteName = uniqueName('Confirm Delete Test');
    const pantheonId = uniqueName('confirmdelete');
    const branchName = uniqueName('confirmable');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Create branch
    await page.locator('.branches-section .create-btn').click();
    await page.locator('.branches-section .form-input').fill(branchName);
    await page.locator('.branches-section .submit-btn').click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Open delete modal
    const branchRow = page.locator(`tr:has-text("${branchName}")`);
    await branchRow.locator('.delete-link').click();

    // Delete button should be disabled
    const deleteBtn = page.getByTestId('delete-button');
    await expect(deleteBtn).toBeDisabled();

    // Type wrong name
    await page.getByTestId('confirm-input').fill('wrong-name');
    await expect(deleteBtn).toBeDisabled();

    // Type correct name
    await page.getByTestId('confirm-input').fill(branchName);
    await expect(deleteBtn).toBeEnabled();
  });

  test('should delete branch when confirmation matches', async ({ page }) => {
    const siteName = uniqueName('Delete Branch Test');
    const pantheonId = uniqueName('deletebranch');
    const branchName = uniqueName('willdelete');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Create branch
    await page.locator('.branches-section .create-btn').click();
    await page.locator('.branches-section .form-input').fill(branchName);
    await page.locator('.branches-section .submit-btn').click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Verify branch exists
    await expect(page.locator('.branches-table')).toContainText(branchName);

    // Open delete modal
    const branchRow = page.locator(`tr:has-text("${branchName}")`);
    await branchRow.locator('.delete-link').click();

    // Confirm deletion
    await page.getByTestId('confirm-input').fill(branchName);
    await page.getByTestId('delete-button').click();

    // Wait for modal to close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

    // Verify branch is removed
    await expect(page.locator('.branches-table')).not.toContainText(branchName);
  });

  test('should close modal when clicking cancel', async ({ page }) => {
    const siteName = uniqueName('Cancel Branch Test');
    const pantheonId = uniqueName('cancelbranch');
    const branchName = uniqueName('cancelable');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Create branch
    await page.locator('.branches-section .create-btn').click();
    await page.locator('.branches-section .form-input').fill(branchName);
    await page.locator('.branches-section .submit-btn').click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Open modal
    const branchRow = page.locator(`tr:has-text("${branchName}")`);
    await branchRow.locator('.delete-link').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Cancel
    await page.getByTestId('cancel-button').click();

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Branch should still exist
    await expect(page.locator('.branches-table')).toContainText(branchName);
  });
});

test.describe('Branch Archive', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should not show archive button for main branch', async ({ page }) => {
    const siteName = uniqueName('No Archive Main');
    const pantheonId = uniqueName('noarchivemain');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Find the main branch row
    const mainRow = page.locator('tr:has-text("main")');
    await expect(mainRow).toBeVisible();

    // Main branch should NOT have an archive button
    await expect(mainRow.locator('.archive-link')).not.toBeVisible();
  });

  test('should archive a non-main branch', async ({ page }) => {
    const siteName = uniqueName('Archive Branch Test');
    const pantheonId = uniqueName('archivebranch');
    const branchName = uniqueName('archivable');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Create a branch
    await page.locator('.branches-section .create-btn').click();
    await page.locator('.branches-section .form-input').fill(branchName);
    await page.locator('.branches-section .submit-btn').click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Find the branch row and click archive
    const branchRow = page.locator(`tr:has-text("${branchName}")`);
    await expect(branchRow).toBeVisible();

    // Wait for API response when archiving
    const responsePromise = page.waitForResponse(resp =>
      resp.url().includes('/branches/') && resp.request().method() === 'PATCH'
    );
    await branchRow.locator('.archive-link').click();
    await responsePromise;

    // Status should change to archived
    await expect(branchRow.locator('.status-badge')).toContainText('archived');

    // Archive button should no longer be visible for this branch
    await expect(branchRow.locator('.archive-link')).not.toBeVisible();
  });

  test('should still show delete button for archived branch', async ({ page }) => {
    const siteName = uniqueName('Delete Archived Test');
    const pantheonId = uniqueName('deletearchived');
    const branchName = uniqueName('deletearchive');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Create a branch
    await page.locator('.branches-section .create-btn').click();
    await page.locator('.branches-section .form-input').fill(branchName);
    await page.locator('.branches-section .submit-btn').click();
    await expect(page.locator('.branches-section .create-form')).not.toBeVisible({ timeout: 10000 });

    // Archive it
    const branchRow = page.locator(`tr:has-text("${branchName}")`);
    const responsePromise = page.waitForResponse(resp =>
      resp.url().includes('/branches/') && resp.request().method() === 'PATCH'
    );
    await branchRow.locator('.archive-link').click();
    await responsePromise;

    // Status should be archived
    await expect(branchRow.locator('.status-badge')).toContainText('archived');

    // Delete button should still be visible
    await expect(branchRow.locator('.delete-link')).toBeVisible();
  });
});

test.describe('Branch Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should navigate to branch detail page when clicking View', async ({ page }) => {
    const siteName = uniqueName('Nav Branch Test');
    const pantheonId = uniqueName('navbranch');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Click View on main branch
    const mainRow = page.locator('tr:has-text("main")');
    await mainRow.locator('.view-link').click();

    // Should navigate to branch detail
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/branches\/[a-z0-9-]+$/);

    // Should show Documents tab
    await expect(page.locator('text=Documents')).toBeVisible();
  });

  test('should show breadcrumb navigation on branch detail page', async ({ page }) => {
    const siteName = uniqueName('Breadcrumb Test');
    const pantheonId = uniqueName('breadcrumb');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Navigate to branch
    const mainRow = page.locator('tr:has-text("main")');
    await mainRow.locator('.view-link').click();

    // Breadcrumb should be visible
    await expect(page.locator('.breadcrumb')).toBeVisible();
    await expect(page.locator('.breadcrumb')).toContainText('Sites');
  });
});
