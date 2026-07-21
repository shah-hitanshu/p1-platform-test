/**
 * Sites Page E2E Tests
 *
 * Tests sites listing and creation.
 */

import { test, expect } from '@playwright/test';

// User IDs from LoginPage.tsx (must be UUIDs to match database schema)
const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

test.describe('Sites Page', () => {
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

  test('should display sites page title', async ({ page }) => {
    await expect(page.getByTestId('page-title')).toContainText('Sites');
    await expect(page.getByTestId('page-subtitle')).toContainText('Manage your collaborative sites');
  });

  test('should have create site button', async ({ page }) => {
    const createBtn = page.getByTestId('create-site-btn');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toContainText('Create new site');
  });

  test('should toggle create form on button click', async ({ page }) => {
    // Form should not be visible initially
    await expect(page.getByTestId('create-form')).not.toBeVisible();

    // Click create button
    await page.getByTestId('create-site-btn').click();

    // Form should be visible
    await expect(page.getByTestId('create-form')).toBeVisible();

    // Button text should change to Cancel
    await expect(page.getByTestId('create-site-btn')).toContainText('Cancel');

    // Click again to hide
    await page.getByTestId('create-site-btn').click();
    await expect(page.getByTestId('create-form')).not.toBeVisible();
  });

  test('should have disabled submit button when input is empty', async ({ page }) => {
    await page.getByTestId('create-site-btn').click();

    const submitBtn = page.getByTestId('submit-site-btn');
    await expect(submitBtn).toBeDisabled();
  });

  test('should enable submit button when both fields entered', async ({ page }) => {
    await page.getByTestId('create-site-btn').click();

    // Type site name and Pantheon ID (both required)
    await page.getByTestId('site-name-input').fill('Test Site');
    await page.getByTestId('pantheon-id-input').fill('test-pantheon-id');

    const submitBtn = page.getByTestId('submit-site-btn');
    await expect(submitBtn).toBeEnabled();
  });
});

test.describe('Sites grid', () => {
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

  test('should render either the sites grid or the empty state', async ({ page }) => {
    await page.waitForTimeout(1000);

    const grid = page.getByTestId('sites-grid');
    const emptyState = page.getByTestId('empty-state');

    const gridVisible = await grid.isVisible();
    const emptyVisible = await emptyState.isVisible();

    expect(gridVisible || emptyVisible).toBe(true);

    if (gridVisible) {
      await expect(grid.locator('[data-testid^="site-row-"]').first()).toBeVisible();
    }
  });

  test('should show empty state when no sites', async ({ page }) => {
    await page.waitForTimeout(1000);

    const emptyState = page.getByTestId('empty-state');
    if (await emptyState.isVisible()) {
      await expect(emptyState).toContainText('No sites found');
    }
  });
});
