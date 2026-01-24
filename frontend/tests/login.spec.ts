/**
 * Login Flow E2E Tests
 *
 * Tests authentication flow for the CSS Explorer.
 */

import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test('should show login page for unauthenticated users', async ({ page }) => {
    await page.goto('/');

    // Should redirect to login
    await expect(page).toHaveURL('/login');

    // Should show login form
    await expect(page.locator('.login-title')).toContainText('CSS Explorer');
    await expect(page.locator('#user-select')).toBeVisible();
  });

  test('should display user options in dropdown', async ({ page }) => {
    await page.goto('/login');

    const select = page.locator('#user-select');
    await select.click();

    // Check that user options are present
    await expect(select.locator('option')).toHaveCount(4); // 3 users + placeholder
  });

  test('should show user preview when user selected', async ({ page }) => {
    await page.goto('/login');

    // Select Alice
    await page.selectOption('#user-select', 'user-alice');

    // Should show user preview
    await expect(page.locator('.user-preview')).toBeVisible();
    await expect(page.locator('.preview-value').first()).toContainText('Alice Developer');
  });

  test('should require user selection before login', async ({ page }) => {
    await page.goto('/login');

    // Login button should be disabled without selection
    const loginButton = page.locator('.login-button');
    await expect(loginButton).toBeDisabled();
  });

  test('should enable login button when user selected', async ({ page }) => {
    await page.goto('/login');

    // Select a user
    await page.selectOption('#user-select', 'user-bob');

    // Login button should be enabled
    const loginButton = page.locator('.login-button');
    await expect(loginButton).toBeEnabled();
  });
});

test.describe('Authentication Flow', () => {
  test('should login and redirect to dashboard', async ({ page }) => {
    await page.goto('/login');

    // Select user and login
    await page.selectOption('#user-select', 'user-alice');
    await page.click('.login-button');

    // Should redirect to dashboard
    await expect(page).toHaveURL('/');

    // Should show user in sidebar
    await expect(page.locator('.user-name')).toContainText('Alice Developer');
  });

  test('should persist login across page reload', async ({ page }) => {
    await page.goto('/login');

    // Login
    await page.selectOption('#user-select', 'user-alice');
    await page.click('.login-button');
    await expect(page).toHaveURL('/');

    // Reload page
    await page.reload();

    // Should still be on dashboard (not redirected to login)
    await expect(page).toHaveURL('/');
    await expect(page.locator('.user-name')).toContainText('Alice Developer');
  });

  test('should logout and redirect to login', async ({ page }) => {
    await page.goto('/login');

    // Login first
    await page.selectOption('#user-select', 'user-alice');
    await page.click('.login-button');
    await expect(page).toHaveURL('/');

    // Logout
    await page.click('.logout-btn');

    // Should be on login page
    await expect(page).toHaveURL('/login');
  });

  test('should clear storage on logout', async ({ page }) => {
    await page.goto('/login');

    // Login
    await page.selectOption('#user-select', 'user-alice');
    await page.click('.login-button');
    await expect(page).toHaveURL('/');

    // Verify storage has token
    const tokenBefore = await page.evaluate(() => localStorage.getItem('css_auth_token'));
    expect(tokenBefore).toBeTruthy();

    // Logout
    await page.click('.logout-btn');

    // Verify storage is cleared
    const tokenAfter = await page.evaluate(() => localStorage.getItem('css_auth_token'));
    expect(tokenAfter).toBeNull();
  });
});
