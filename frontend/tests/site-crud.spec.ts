/**
 * Site CRUD E2E Tests
 *
 * Tests complete site lifecycle: create, read, and delete operations.
 * These tests use unique timestamps to ensure test isolation.
 */

import { test, expect } from '@playwright/test';

// User IDs from LoginPage.tsx (must be UUIDs to match database schema)
const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

// Helper to generate unique names for each test
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Helper to create a site and wait for API response
async function createSite(page: import('@playwright/test').Page, siteName: string, pantheonId: string) {
  await page.getByTestId('create-site-btn').click();
  await page.getByTestId('site-name-input').fill(siteName);
  await page.getByTestId('pantheon-id-input').fill(pantheonId);

  // Wait for API response
  const responsePromise = page.waitForResponse(resp =>
    resp.url().includes('/api/sites') && resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-site-btn').click();
  await responsePromise;

  // Wait for form to close
  await expect(page.getByTestId('create-form')).not.toBeVisible({ timeout: 10000 });
}

test.describe('Site Creation', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');

    // Navigate to sites
    await page.getByTestId('nav-sites').click();
    await expect(page).toHaveURL('/sites');
  });

  test('should create a new site with valid inputs', async ({ page }) => {
    const siteName = uniqueName('Create Site');
    const pantheonId = uniqueName('pantheon');

    // Open create form
    await page.getByTestId('create-site-btn').click();
    await expect(page.getByTestId('create-form')).toBeVisible();

    // Fill in site details
    const nameInput = page.getByTestId('site-name-input');
    const pantheonIdInput = page.getByTestId('pantheon-id-input');

    await nameInput.fill(siteName);
    await pantheonIdInput.fill(pantheonId);

    // Submit button should be enabled
    const submitBtn = page.getByTestId('submit-site-btn');
    await expect(submitBtn).toBeEnabled();

    // Create the site
    await submitBtn.click();

    // Wait for the form to close (indicates success)
    await expect(page.getByTestId('create-form')).not.toBeVisible({ timeout: 10000 });

    // Verify site appears in the table
    await expect(page.getByTestId('sites-table')).toBeVisible();
    await expect(page.getByTestId('sites-table')).toContainText(siteName);
  });

  test('should not create site with empty name', async ({ page }) => {
    await page.getByTestId('create-site-btn').click();

    // Only fill Pantheon ID
    const pantheonIdInput = page.getByTestId('pantheon-id-input');
    await pantheonIdInput.fill('some-id');

    // Submit button should be disabled
    await expect(page.getByTestId('submit-site-btn')).toBeDisabled();
  });

  test('should not create site with empty Pantheon ID', async ({ page }) => {
    await page.getByTestId('create-site-btn').click();

    // Only fill name
    const nameInput = page.getByTestId('site-name-input');
    await nameInput.fill('Some Site');

    // Submit button should be disabled
    await expect(page.getByTestId('submit-site-btn')).toBeDisabled();
  });
});

test.describe('Site Deletion', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');

    // Navigate to sites
    await page.getByTestId('nav-sites').click();
    await expect(page).toHaveURL('/sites');
  });

  test('should open delete confirmation modal when clicking delete', async ({ page }) => {
    const siteName = uniqueName('Modal Test');
    const pantheonId = uniqueName('modal');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Find and click the delete button for our site
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await expect(siteRow).toBeVisible();
    await siteRow.locator('[data-testid^="delete-site-"]').click();

    // Modal should be visible (PDS Modal uses role="dialog" with aria label)
    const dialog = page.getByRole('dialog', { name: /Delete site confirmation/i });
    await expect(dialog).toBeVisible();
  });

  test('should require typing site name to confirm deletion', async ({ page }) => {
    const siteName = uniqueName('Confirm Test');
    const pantheonId = uniqueName('confirm');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Click delete
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('[data-testid^="delete-site-"]').click();

    // Delete button should be disabled initially
    const deleteBtn = page.getByTestId('delete-button');
    await expect(deleteBtn).toBeDisabled();

    // Type wrong name
    await page.getByTestId('confirm-input').fill('wrong name');
    await expect(deleteBtn).toBeDisabled();

    // Type correct name
    await page.getByTestId('confirm-input').fill(siteName);
    await expect(deleteBtn).toBeEnabled();
  });

  // Note: Sites with only the main branch can be deleted.
  // Sites with additional non-main branches must have those branches
  // archived or deleted first.

  test('should show error when deleting site with non-main branches', async ({ page }) => {
    // Sites with non-main branches cannot be deleted (409 Conflict)
    const siteName = uniqueName('Has Branches');
    const pantheonId = uniqueName('hasbranches');

    // Create a site (will have main branch)
    await createSite(page, siteName, pantheonId);

    // Navigate to site to create an additional branch
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('[data-testid^="view-site-"]').click();
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);

    // Create a feature branch
    await page.getByTestId('create-branch-btn').click();
    await page.getByTestId('branch-name-input').fill('feature-branch');
    const branchResponsePromise = page.waitForResponse(resp =>
      resp.url().includes('/branches') && resp.request().method() === 'POST'
    );
    await page.getByTestId('submit-branch-btn').click();
    await branchResponsePromise;
    // Wait for form to close and branch to appear
    await expect(page.getByTestId('create-branch-form')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('tr:has-text("feature-branch")')).toBeVisible({ timeout: 10000 });

    // Go back to sites list
    await page.click('.nav-link >> text=Sites');
    await expect(page).toHaveURL('/sites');

    // Try to delete (should fail because of non-main branch)
    const siteRow2 = page.locator(`tr:has-text("${siteName}")`);
    await siteRow2.locator('[data-testid^="delete-site-"]').click();
    await page.getByTestId('confirm-input').fill(siteName);
    await page.getByTestId('delete-button').click();

    // Should show error in modal (site has branches)
    await expect(page.getByTestId('modal-error')).toBeVisible({ timeout: 10000 });

    // Modal should still be open
    await expect(page.getByRole('dialog')).toBeVisible();

    // Site should still exist after closing modal
    await page.getByTestId('cancel-button').click();
    await expect(page.getByTestId('sites-table')).toContainText(siteName);
  });

  test('should successfully delete site after archiving non-main branches', async ({ page }) => {
    const siteName = uniqueName('Archive Delete');
    const pantheonId = uniqueName('archivedelete');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Navigate to site to create an additional branch
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('[data-testid^="view-site-"]').click();
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);

    // Create a feature branch
    await page.getByTestId('create-branch-btn').click();
    await page.getByTestId('branch-name-input').fill('feature-branch');
    const branchResponsePromise = page.waitForResponse(resp =>
      resp.url().includes('/branches') && resp.request().method() === 'POST'
    );
    await page.getByTestId('submit-branch-btn').click();
    await branchResponsePromise;
    await expect(page.locator('tr:has-text("feature-branch")')).toBeVisible({ timeout: 10000 });

    // Archive the feature branch
    const featureRow = page.locator('tr:has-text("feature-branch")');
    const archiveResponsePromise = page.waitForResponse(resp =>
      resp.url().includes('/branches/') && resp.request().method() === 'PATCH'
    );
    await featureRow.locator('[data-testid^="archive-branch-"]').click();
    await archiveResponsePromise;

    // Verify branch is now archived
    await expect(featureRow.locator('.tag')).toContainText('archived');

    // Go back to sites list
    await page.click('.nav-link >> text=Sites');
    await expect(page).toHaveURL('/sites');

    // Delete the site (should work now since branch is archived)
    const siteRow2 = page.locator(`tr:has-text("${siteName}")`);
    await siteRow2.locator('[data-testid^="delete-site-"]').click();
    await page.getByTestId('confirm-input').fill(siteName);

    const deleteResponsePromise = page.waitForResponse(resp =>
      resp.url().includes('/api/sites/') && resp.request().method() === 'DELETE'
    );
    await page.getByTestId('delete-button').click();
    await deleteResponsePromise;

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

    // Site should be removed from list
    await expect(page.getByTestId('sites-table')).not.toContainText(siteName);
  });

  test('should close modal when clicking cancel', async ({ page }) => {
    const siteName = uniqueName('Cancel Test');
    const pantheonId = uniqueName('cancel');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Open delete modal
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('[data-testid^="delete-site-"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click cancel
    await page.getByTestId('cancel-button').click();

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Site should still exist
    await expect(page.getByTestId('sites-table')).toContainText(siteName);
  });

  test('should close modal when clicking overlay', async ({ page }) => {
    const siteName = uniqueName('Overlay Test');
    const pantheonId = uniqueName('overlay');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Open delete modal
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('[data-testid^="delete-site-"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click overlay (PDS Modal uses @reach/dialog overlay)
    await page.locator('[data-reach-dialog-overlay]').click({ position: { x: 10, y: 10 } });

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Site should still exist
    await expect(page.getByTestId('sites-table')).toContainText(siteName);
  });
});

test.describe('Site Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
    await page.click('.nav-link >> text=Sites');
    await expect(page).toHaveURL('/sites');
  });

  test('should navigate to site detail page when clicking View', async ({ page }) => {
    const siteName = uniqueName('View Site');
    const pantheonId = uniqueName('view');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Click View link
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('[data-testid^="view-site-"]').click();

    // Should navigate to site detail page
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);

    // Should show site title
    await expect(page.getByTestId('site-title')).toContainText(siteName);
  });
});
