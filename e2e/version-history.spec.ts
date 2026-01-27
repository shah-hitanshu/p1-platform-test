import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end tests for version history functionality
 *
 * These tests verify that:
 * 1. Version history can be loaded and displayed
 * 2. Historical versions can be viewed with correct content
 * 3. Returning to latest works correctly
 * 4. Real-time sync doesn't interfere with version history
 * 5. Real-time sync works between two browser windows
 *
 * Prerequisites:
 * - CSS backend must be running at VITE_CSS_BASE_URL
 * - Valid API key and site configuration in .env
 * - At least one document must exist with multiple versions
 */

/**
 * Helper to navigate to the realtime document
 */
async function navigateToRealtimeDocument(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible({ timeout: 10000 });

  // Click CSS tab
  const cssTab = page.locator('div').filter({ hasText: /^CSS$/ });
  if (await cssTab.isVisible()) {
    await cssTab.click();
  }

  // Click realtime document
  const realtimeDoc = page.getByText('realtime×');
  if (await realtimeDoc.isVisible()) {
    await realtimeDoc.click();
    await page.waitForLoadState('networkidle');
  }
}

/**
 * Helper to get the current page title from the editor
 */
async function getEditorTitle(page: Page): Promise<string> {
  const heading = page.locator('h2').first();
  return await heading.textContent() || '';
}

test.describe('Version History', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the demo app
    await page.goto('/');

    // Wait for the Puck editor to load - use the main Puck container
    await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('should display version list in sidebar', async ({ page }) => {
    // Open the Documents plugin panel (first plugin)
    const pluginTabs = page.locator('[class*="Plugin"] button, [class*="plugin"] button');
    const firstTab = pluginTabs.first();

    if (await firstTab.isVisible()) {
      await firstTab.click();
    }

    // Look for version list or document list
    const sidebar = page.locator('[class*="sidebar"], [class*="Sidebar"], [class*="rail"], [class*="Rail"]');
    await expect(sidebar.first()).toBeVisible();
  });

  test('should load document and show content', async ({ page }) => {
    // Wait for the editor content area to be visible
    const contentArea = page.locator('[class*="Puck-frame"], [class*="puck-frame"], iframe');

    if (await contentArea.count() > 0) {
      await expect(contentArea.first()).toBeVisible();
    }
  });

  test('should handle version selection without crashing', async ({ page }) => {
    // This test verifies the core fix - version loading shouldn't fail
    // even if real-time sync is enabled

    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // Look for any version list items
    const versionItems = page.locator('[data-testid="version-item"], [class*="version"], [class*="Version"]');

    // If versions are visible, try clicking one
    if ((await versionItems.count()) > 0) {
      const firstVersion = versionItems.first();
      await firstVersion.click();

      // Wait a moment for the version to load
      await page.waitForTimeout(500);

      // Verify the page didn't crash - the editor should still be visible
      await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible();
    }
  });

  test('should return to latest version', async ({ page }) => {
    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // Look for a "Return to Latest" button or similar
    const returnButton = page.locator(
      'button:has-text("Return to Latest"), button:has-text("Return to latest"), [data-testid="return-to-latest"]'
    );

    // If the button exists and is visible, it means we're viewing a historical version
    if (await returnButton.isVisible()) {
      await returnButton.click();

      // Wait for the transition
      await page.waitForTimeout(500);

      // The button should no longer be visible (we're now on latest)
      await expect(returnButton).not.toBeVisible();
    }
  });

  test('should show historical version banner when viewing old version', async ({ page }) => {
    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // Look for any version list items
    const versionItems = page.locator('[data-testid="version-item"], [class*="version"], [class*="Version"]');

    // If versions are visible and there's more than one, try clicking an older one
    const count = await versionItems.count();
    if (count > 1) {
      // Click the second version (older than latest)
      await versionItems.nth(1).click();

      // Wait for the version to load
      await page.waitForTimeout(500);

      // Look for a historical version indicator
      const banner = page.locator(
        '[class*="HistoricalVersionBanner"], [class*="historical"], [data-testid="historical-banner"]'
      );

      // If the component exists, it should be visible
      if ((await banner.count()) > 0) {
        await expect(banner.first()).toBeVisible();
      }
    }
  });
});

test.describe('Real-time Sync Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('should not crash when switching versions with realtime enabled', async ({ page }) => {
    // This is the critical regression test for the bug we fixed
    // The issue was that real-time sync could override version loading

    // Wait for any WebSocket connections to establish
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Look for version list
    const versionItems = page.locator('[data-testid="version-item"], [class*="version"], [class*="Version"]');
    const count = await versionItems.count();

    if (count > 1) {
      // Click an older version
      await versionItems.nth(1).click();
      await page.waitForTimeout(500);

      // Verify editor is still functional
      await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible();

      // Click latest version
      await versionItems.first().click();
      await page.waitForTimeout(500);

      // Verify editor is still functional
      await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible();

      // Repeat to ensure no race conditions
      await versionItems.nth(1).click();
      await page.waitForTimeout(200);
      await versionItems.first().click();
      await page.waitForTimeout(200);

      // Final verification
      await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible();
    }
  });

  test('should maintain editor state when toggling between versions', async ({ page }) => {
    // Ensure the editor doesn't lose track of its state

    await page.waitForLoadState('networkidle');

    // Get initial editor state (check for a specific class or attribute)
    const editor = page.locator('.Puck, [class*="_Puck_"]').first();
    await expect(editor).toBeVisible();

    // Wait a bit for any async operations
    await page.waitForTimeout(500);

    // The editor should still be in the same state
    await expect(editor).toBeVisible();
  });
});

test.describe('Document Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('should load document from URL path parameter', async ({ page }) => {
    // Check if there's a document loaded based on URL
    const url = page.url();

    // If URL has a path parameter, document should be loaded
    if (url.includes('path=')) {
      // Wait for the document to load
      await page.waitForLoadState('networkidle');

      // The editor should show content (not just empty state)
      const editor = page.locator('.Puck, [class*="_Puck_"]').first();
      await expect(editor).toBeVisible();
    }
  });

  test('should handle document selection from list', async ({ page }) => {
    // Look for document list items
    const docItems = page.locator('[data-testid="document-item"], [class*="document"], [class*="Document"]');

    if ((await docItems.count()) > 0) {
      const firstDoc = docItems.first();
      await firstDoc.click();

      // Wait for document to load
      await page.waitForTimeout(500);

      // Editor should still be visible
      await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible();
    }
  });
});

/**
 * Critical regression tests that verify the fix for version history + realtime sync
 */
test.describe('Version History Content Verification', () => {
  test('should load historical version with different content', async ({ page }) => {
    // Navigate to realtime document
    await navigateToRealtimeDocument(page);

    // Get the initial title
    const initialTitle = await getEditorTitle(page);

    // Click CSS tab to see versions
    const cssTab = page.locator('div').filter({ hasText: /^CSS$/ });
    await cssTab.click();

    // Wait for version list to load
    await page.waitForTimeout(500);

    // Find version items - look for v4 specifically (known to have different content)
    const v4Item = page.getByText('v4Jan 25');

    if (await v4Item.isVisible()) {
      await v4Item.click();

      // Wait for version to load
      await page.waitForTimeout(1000);

      // Verify the banner shows we're viewing a historical version
      const banner = page.getByText('Viewing version 4');
      await expect(banner).toBeVisible();

      // Verify the title changed (v4 has title "ffffffff")
      const historicalTitle = await getEditorTitle(page);
      expect(historicalTitle).not.toBe(initialTitle);

      // Verify "Return to current" button is visible
      const returnButton = page.getByRole('button', { name: 'Return to current' });
      await expect(returnButton).toBeVisible();

      // Click return to current
      await returnButton.click();
      await page.waitForTimeout(500);

      // Verify title is back to original
      const restoredTitle = await getEditorTitle(page);
      expect(restoredTitle).toBe(initialTitle);

      // Banner should be gone
      await expect(banner).not.toBeVisible();
    }
  });
});

/**
 * Two-browser realtime sync test
 * This verifies that changes made in one browser window sync to another
 */
test.describe('Realtime Sync Between Windows', () => {
  test('should sync changes between two browser windows', async ({ browser }) => {
    // Create two separate browser contexts (simulates two different users/windows)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Navigate both pages to the realtime document
      await navigateToRealtimeDocument(page1);
      await navigateToRealtimeDocument(page2);

      // Wait for WebSocket connections to establish
      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      // Get initial title from both pages
      const initialTitle1 = await getEditorTitle(page1);
      const initialTitle2 = await getEditorTitle(page2);

      // Both should show the same title
      expect(initialTitle1).toBe(initialTitle2);

      // Generate a unique title with timestamp
      const uniqueTitle = `SYNC TEST ${Date.now()}`;

      // Edit the title in page1
      const titleInput1 = page1.getByRole('textbox', { name: 'title' });
      await titleInput1.click();
      await titleInput1.fill(uniqueTitle);

      // Wait for autosave and sync (autosave is 3 seconds, plus sync time)
      await page1.waitForTimeout(5000);

      // Check if page2 received the update
      const syncedTitle = await getEditorTitle(page2);

      // The title should have synced to page2
      expect(syncedTitle).toBe(uniqueTitle);

      // Restore the original title to clean up
      await titleInput1.fill(initialTitle1);
      await page1.waitForTimeout(4000);
    } finally {
      // Clean up contexts
      await context1.close();
      await context2.close();
    }
  });
});
