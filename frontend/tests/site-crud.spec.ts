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
  await page.click('.create-btn');
  await page.locator('.form-input').first().fill(siteName);
  await page.locator('.form-input').nth(1).fill(pantheonId);

  // Wait for API response
  const responsePromise = page.waitForResponse(resp =>
    resp.url().includes('/api/sites') && resp.request().method() === 'POST'
  );
  await page.click('.submit-btn');
  await responsePromise;

  // Wait for form to close
  await expect(page.locator('.create-form')).not.toBeVisible({ timeout: 10000 });
}

test.describe('Site Creation', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');

    // Navigate to sites
    await page.click('.nav-link >> text=Sites');
    await expect(page).toHaveURL('/sites');
  });

  test('should create a new site with valid inputs', async ({ page }) => {
    const siteName = uniqueName('Create Site');
    const pantheonId = uniqueName('pantheon');

    // Open create form
    await page.click('.create-btn');
    await expect(page.locator('.create-form')).toBeVisible();

    // Fill in site details
    const nameInput = page.locator('.form-input').first();
    const pantheonIdInput = page.locator('.form-input').nth(1);

    await nameInput.fill(siteName);
    await pantheonIdInput.fill(pantheonId);

    // Submit button should be enabled
    const submitBtn = page.locator('.submit-btn');
    await expect(submitBtn).toBeEnabled();

    // Create the site
    await submitBtn.click();

    // Wait for the form to close (indicates success)
    await expect(page.locator('.create-form')).not.toBeVisible({ timeout: 10000 });

    // Verify site appears in the table
    await expect(page.locator('.sites-table')).toBeVisible();
    await expect(page.locator('.sites-table')).toContainText(siteName);
  });

  test('should not create site with empty name', async ({ page }) => {
    await page.click('.create-btn');

    // Only fill Pantheon ID
    const pantheonIdInput = page.locator('.form-input').nth(1);
    await pantheonIdInput.fill('some-id');

    // Submit button should be disabled
    await expect(page.locator('.submit-btn')).toBeDisabled();
  });

  test('should not create site with empty Pantheon ID', async ({ page }) => {
    await page.click('.create-btn');

    // Only fill name
    const nameInput = page.locator('.form-input').first();
    await nameInput.fill('Some Site');

    // Submit button should be disabled
    await expect(page.locator('.submit-btn')).toBeDisabled();
  });
});

test.describe('Site Deletion', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
    await expect(page).toHaveURL('/');

    // Navigate to sites
    await page.click('.nav-link >> text=Sites');
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
    await siteRow.locator('.delete-link').click();

    // Modal should be visible
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.modal-title')).toContainText('Delete site?');
  });

  test('should require typing site name to confirm deletion', async ({ page }) => {
    const siteName = uniqueName('Confirm Test');
    const pantheonId = uniqueName('confirm');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Click delete
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('.delete-link').click();

    // Delete button should be disabled initially
    const deleteBtn = page.locator('.modal-content .delete-btn');
    await expect(deleteBtn).toBeDisabled();

    // Type wrong name
    await page.locator('.confirm-input').fill('wrong name');
    await expect(deleteBtn).toBeDisabled();

    // Type correct name
    await page.locator('.confirm-input').fill(siteName);
    await expect(deleteBtn).toBeEnabled();
  });

  // Note: Successful site deletion requires archiving all branches first.
  // This is tested in the branch deletion tests. Here we test that the
  // modal correctly shows errors and doesn't close prematurely.

  test('should show error when deleting site with branches', async ({ page }) => {
    // Sites with branches cannot be deleted (409 Conflict)
    // Every new site gets a main branch auto-created
    const siteName = uniqueName('Has Branches');
    const pantheonId = uniqueName('hasbranches');

    // Create a site (will have main branch)
    await createSite(page, siteName, pantheonId);

    // Try to delete (should fail because of main branch)
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('.delete-link').click();
    await page.locator('.confirm-input').fill(siteName);
    await page.locator('.modal-content .delete-btn').click();

    // Should show error in modal (site has branches)
    await expect(page.locator('.modal-error')).toBeVisible({ timeout: 10000 });

    // Modal should still be open
    await expect(page.locator('.modal-overlay')).toBeVisible();

    // Site should still exist after closing modal
    await page.locator('.cancel-btn').click();
    await expect(page.locator('.sites-table')).toContainText(siteName);
  });

  test('should close modal when clicking cancel', async ({ page }) => {
    const siteName = uniqueName('Cancel Test');
    const pantheonId = uniqueName('cancel');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Open delete modal
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('.delete-link').click();
    await expect(page.locator('.modal-overlay')).toBeVisible();

    // Click cancel
    await page.locator('.cancel-btn').click();

    // Modal should close
    await expect(page.locator('.modal-overlay')).not.toBeVisible();

    // Site should still exist
    await expect(page.locator('.sites-table')).toContainText(siteName);
  });

  test('should close modal when clicking overlay', async ({ page }) => {
    const siteName = uniqueName('Overlay Test');
    const pantheonId = uniqueName('overlay');

    // Create a site
    await createSite(page, siteName, pantheonId);

    // Open delete modal
    const siteRow = page.locator(`tr:has-text("${siteName}")`);
    await siteRow.locator('.delete-link').click();
    await expect(page.locator('.modal-overlay')).toBeVisible();

    // Click overlay (not the modal content)
    await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });

    // Modal should close
    await expect(page.locator('.modal-overlay')).not.toBeVisible();

    // Site should still exist
    await expect(page.locator('.sites-table')).toContainText(siteName);
  });
});

test.describe('Site Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.selectOption('#user-select', ALICE_USER_ID);
    await page.click('.login-button');
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
    await siteRow.locator('.view-link').click();

    // Should navigate to site detail page
    await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);

    // Should show site title
    await expect(page.locator('.site-title')).toContainText(siteName);
  });
});
