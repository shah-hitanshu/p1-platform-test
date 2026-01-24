/**
 * Dashboard Page E2E Tests
 *
 * Tests dashboard functionality.
 */

import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.selectOption('#user-select', 'user-alice');
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should display dashboard title', async ({ page }) => {
    await expect(page.locator('.page-title')).toContainText('Dashboard');
  });

  test('should display system health section', async ({ page }) => {
    await expect(page.locator('.card-title').first()).toContainText('System Health');
  });

  test('should have refresh button for health check', async ({ page }) => {
    const refreshBtn = page.locator('.refresh-btn');
    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toContainText('Refresh');
  });

  test('should display quick actions section', async ({ page }) => {
    await expect(page.locator('.card-title').nth(1)).toContainText('Quick Actions');

    // Check action links
    await expect(page.locator('.action-link')).toHaveCount(2);
  });

  test('should display API endpoints reference', async ({ page }) => {
    await expect(page.locator('.card-title').nth(2)).toContainText('API Endpoints');

    // Check some endpoints are listed
    await expect(page.locator('.endpoint-item')).toHaveCount(5);
  });

  test('should navigate to sites from quick action', async ({ page }) => {
    // Click "View Sites" link
    const viewSitesLink = page.locator('.action-link').filter({ hasText: 'View Sites' });
    await viewSitesLink.click();

    await expect(page).toHaveURL('/sites');
  });
});

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.selectOption('#user-select', 'user-alice');
    await page.click('.login-button');
    await expect(page).toHaveURL('/');
  });

  test('should show sidebar navigation', async ({ page }) => {
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar-title')).toContainText('CSS Explorer');
  });

  test('should have Dashboard link active on dashboard', async ({ page }) => {
    const dashboardLink = page.locator('.nav-link').filter({ hasText: 'Dashboard' });
    await expect(dashboardLink).toHaveClass(/active/);
  });

  test('should navigate to Sites page', async ({ page }) => {
    const sitesLink = page.locator('.nav-link').filter({ hasText: 'Sites' });
    await sitesLink.click();

    await expect(page).toHaveURL('/sites');
    await expect(sitesLink).toHaveClass(/active/);
  });

  test('should show user info in sidebar', async ({ page }) => {
    await expect(page.locator('.user-name')).toContainText('Alice Developer');
    await expect(page.locator('.user-email')).toContainText('alice@example.com');
  });
});
