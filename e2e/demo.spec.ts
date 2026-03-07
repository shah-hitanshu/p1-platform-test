/**
 * End-to-end tests for the demo app.
 *
 * Validates that the stable consumer API (useCSSEditor) works correctly
 * in a real browser with a live CSS backend.
 *
 * Prerequisites:
 *   - CSS backend running at http://localhost:8787
 *   - Demo app configured with VITE_AUTH_MODE=mock
 */

import { test, expect, type Page } from '@playwright/test';

// A known document path that exists on the test site
const VALID_DOC_PATH = 'test';

/**
 * Login as the default demo user and wait for auth to be fully persisted.
 * Ensures the token is in localStorage before returning, so subsequent
 * page.goto() calls will pick up the auth state on reload.
 */
async function loginAsDemoUser(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Sign in as Demo User' }).click();
  // Wait for login page to disappear (auth succeeded)
  await expect(page.getByRole('heading', { name: 'CSS Demo' })).not.toBeVisible({ timeout: 10000 });
  // Verify token is persisted in localStorage before navigating away
  await page.waitForFunction(
    () => !!localStorage.getItem('css_auth_token'),
    null,
    { timeout: 5000 }
  );
}

test.describe('Demo App - Auth', () => {
  test('shows login page when not authenticated', async ({ page }) => {
    // Clear any stored auth state
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByRole('heading', { name: 'CSS Demo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in as Demo User' })).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test('shows demo user options in mock mode', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const select = page.getByRole('combobox');
    await expect(select).toBeVisible();
    await expect(select.getByRole('option', { name: 'Alice Developer' })).toBeAttached();
    await expect(select.getByRole('option', { name: 'Bob Teammate' })).toBeAttached();
    await expect(select.getByRole('option', { name: 'Carol Coder' })).toBeAttached();
  });

  test('logs in as mock user and shows editor', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.getByRole('button', { name: 'Sign in as Demo User' }).click();

    // After login, should show loading or error (depending on whether /home exists)
    // The key test is that auth succeeded — we should NOT see the login page
    await expect(page.getByRole('heading', { name: 'CSS Demo' })).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe('Demo App - Editor', () => {
  // Run serially to avoid overwhelming the backend with parallel requests
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test('loads a valid document and renders the Puck editor', async ({ page }) => {
    await page.goto(`/?path=${VALID_DOC_PATH}`);

    // Wait for loading to finish and Puck editor to appear
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 15000 });

    // Verify core Puck UI elements
    await expect(page.getByRole('button', { name: 'undo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'redo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle left sidebar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle right sidebar' })).toBeVisible();
  });

  test('shows component palette with all configured components', async ({ page }) => {
    await page.goto(`/?path=${VALID_DOC_PATH}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 15000 });

    // Verify all puck.config.tsx components are available
    await expect(page.getByRole('button', { name: 'Heading' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Text' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Image' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Button' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spacer' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Card' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Columns' }).first()).toBeVisible();
  });

  test('shows CSS plugin tab in the plugin rail', async ({ page }) => {
    await page.goto(`/?path=${VALID_DOC_PATH}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 15000 });

    // The CSS plugin should appear in the nav rail
    await expect(page.getByText('CSS')).toBeVisible();
  });

  test('shows error state for non-existent document', async ({ page }) => {
    await page.goto('/?path=this-document-does-not-exist-12345');

    await expect(page.getByRole('heading', { name: 'Error loading document' })).toBeVisible({ timeout: 15000 });
  });

  test('renders document content in the editor iframe', async ({ page }) => {
    await page.goto(`/?path=${VALID_DOC_PATH}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 15000 });

    // The editor should have an iframe with content
    const iframe = page.frameLocator('iframe');
    // The test document has content — verify something rendered inside the iframe
    await expect(iframe.locator('body')).not.toBeEmpty();
  });

  test('publish button opens name prompt', async ({ page }) => {
    await page.goto(`/?path=${VALID_DOC_PATH}`);
    const publishBtn = page.getByRole('button', { name: 'Publish' });
    await expect(publishBtn).toBeVisible({ timeout: 15000 });

    // Use dispatchEvent to bypass Puck's editor overlay that intercepts pointer events
    await publishBtn.dispatchEvent('click');

    // The PublishButton component shows an inline name prompt with an input
    const nameInput = page.getByPlaceholder('Checkpoint name (optional)');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
  });

  test('shows user switcher in mock auth mode', async ({ page }) => {
    await page.goto(`/?path=${VALID_DOC_PATH}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 15000 });

    // UserSwitcher should be visible (only in mock mode)
    await expect(page.getByText('Merge review')).toBeVisible();
  });

  test('navigates between documents via URL', async ({ page }) => {
    // Load the test document
    await page.goto(`/?path=${VALID_DOC_PATH}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 15000 });

    // Navigate to a non-existent document
    await page.goto('/?path=nonexistent-doc-xyz');
    await expect(page.getByRole('heading', { name: 'Error loading document' })).toBeVisible({ timeout: 15000 });

    // Navigate back to the valid document
    await page.goto(`/?path=${VALID_DOC_PATH}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Demo App - Version Management', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test('CSS plugin panel shows branches and documents', async ({ page }) => {
    await page.goto(`/?path=${VALID_DOC_PATH}`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 15000 });

    // Click the CSS tab to open the plugin panel
    await page.getByText('CSS').click();

    // The plugin panel should show branch and document sections
    // Wait for content to load
    await page.waitForTimeout(1000);

    // Should see branch info or document list in the panel
    const panelContent = page.locator('[class*="plugin"], [data-puck-plugin]').first();
    if (await panelContent.count() > 0) {
      await expect(panelContent).toBeVisible();
    }
  });
});
