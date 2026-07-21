/**
 * Dashboard Page E2E Tests
 *
 * Tests dashboard functionality.
 */

import { test, expect } from '@playwright/test';

// User IDs from LoginPage.tsx (must be UUIDs to match database schema)
const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should display dashboard title', async ({ page }) => {
    await expect(page.getByTestId('page-title')).toContainText('Dashboard');
  });

  test('should display system health section', async ({ page }) => {
    await expect(page.getByTestId('card-title-health')).toContainText('System Health');
  });

  test('should have refresh button for health check', async ({ page }) => {
    const refreshBtn = page.getByTestId('refresh-health-btn');
    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toContainText('Refresh');
  });

  test('should display quick actions section', async ({ page }) => {
    await expect(page.getByTestId('card-title-actions')).toContainText('Quick Actions');

    // Check action links
    await expect(page.getByTestId('create-site-action')).toBeVisible();
    await expect(page.getByTestId('view-sites-action')).toBeVisible();
  });

  test('should display API endpoints reference', async ({ page }) => {
    await expect(page.getByTestId('card-title-endpoints')).toContainText('API Endpoints');

    // Check some endpoints are listed
    await expect(page.getByTestId('endpoints-list').locator('[data-testid^="endpoint-"]')).toHaveCount(5);
  });

  test('should navigate to sites from quick action', async ({ page }) => {
    // Click "View Sites" link
    await page.getByTestId('view-sites-action').click();

    await expect(page).toHaveURL('/sites');
  });
});

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should show sidebar navigation', async ({ page }) => {
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('sidebar-title')).toContainText('CSS Explorer');
  });

  test('should have Dashboard link active on dashboard', async ({ page }) => {
    const dashboardLink = page.getByTestId('nav-dashboard');
    await expect(dashboardLink).toHaveClass(/active/);
  });

  test('should navigate to Sites page', async ({ page }) => {
    const sitesLink = page.getByTestId('nav-sites');
    await sitesLink.click();

    await expect(page).toHaveURL('/sites');
    await expect(sitesLink).toHaveClass(/active/);
  });

  test('should show user info in sidebar', async ({ page }) => {
    await expect(page.getByTestId('user-name')).toContainText('Alice Developer');
    await expect(page.getByTestId('user-email')).toContainText('alice@example.com');
  });
});
