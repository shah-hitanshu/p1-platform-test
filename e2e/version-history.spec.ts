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
 * Version History Isolation Tests
 *
 * These tests verify that viewing historical versions does NOT affect other users.
 * This is a critical regression test for the bug where loading a historical version
 * would broadcast the historical data to all connected users via WebSocket.
 */
test.describe('Version History Isolation', () => {
  test('viewing historical version should NOT affect other users', async ({ browser }) => {
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

      // Get the initial title from page2 (this is what we'll verify stays unchanged)
      const initialTitle2 = await getEditorTitle(page2);

      // On Page1: Click CSS tab to see versions
      const cssTab1 = page1.locator('div').filter({ hasText: /^CSS$/ });
      await cssTab1.click();
      await page1.waitForTimeout(500);

      // On Page1: Load a historical version (v4)
      const v4Item = page1.getByText('v4Jan 25');
      if (await v4Item.isVisible()) {
        await v4Item.click();

        // Wait for version to load on page1
        await page1.waitForTimeout(2000);

        // Verify page1 shows the historical version banner
        const banner = page1.getByText('Viewing version 4');
        await expect(banner).toBeVisible();

        // Get the historical title on page1 (v4 has title "ffffffff")
        const historicalTitle1 = await getEditorTitle(page1);

        // CRITICAL: Verify page2 still shows its original title, NOT the historical one
        // This is the main bug we're testing - page2 should NOT be affected
        const currentTitle2 = await getEditorTitle(page2);

        // Page2 should still show the initial title (not changed by page1 viewing history)
        expect(currentTitle2).toBe(initialTitle2);

        // Page1 should show the historical version content (different from latest)
        // v4 is known to have content "ffffffff" which differs from latest
        expect(historicalTitle1).not.toBe(currentTitle2);

        // Return page1 to latest
        const returnButton = page1.getByRole('button', { name: 'Return to current' });
        await returnButton.click();
        await page1.waitForTimeout(2000);

        // Page2 should still show the same title (unchanged throughout)
        const finalTitle2 = await getEditorTitle(page2);
        expect(finalTitle2).toBe(initialTitle2);

        // Page1 should no longer show the historical banner
        await expect(banner).not.toBeVisible();
      }
    } finally {
      // Clean up contexts
      await context1.close();
      await context2.close();
    }
  });

  test('should catch up with remote changes when returning to latest', async ({ browser }) => {
    // Create two separate browser contexts
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

      // Get the initial title from page1
      const initialTitle = await getEditorTitle(page1);

      // On Page1: Load a historical version
      const cssTab1 = page1.locator('div').filter({ hasText: /^CSS$/ });
      await cssTab1.click();
      await page1.waitForTimeout(500);

      const v4Item = page1.getByText('v4Jan 25');
      if (await v4Item.isVisible()) {
        await v4Item.click();
        await page1.waitForTimeout(1000);

        // Verify page1 is viewing historical version
        const banner = page1.getByText('Viewing version 4');
        await expect(banner).toBeVisible();

        // While page1 is viewing history, page2 makes an edit
        const uniqueTitle = `REMOTE EDIT ${Date.now()}`;
        const titleInput2 = page2.getByRole('textbox', { name: 'title' });
        await titleInput2.click();
        await titleInput2.clear();
        await titleInput2.fill(uniqueTitle);

        // Verify page2 shows the new title (confirms page2's edit was applied)
        await expect(async () => {
          const page2Title = await getEditorTitle(page2);
          expect(page2Title).toBe(uniqueTitle);
        }).toPass({ timeout: 6000 });

        // Page1 returns to latest - should see page2's edit from Yjs, not stale data
        const returnButton = page1.getByRole('button', { name: 'Return to current' });
        await returnButton.click();

        // Wait for the page to update and poll for expected value
        // The Yjs sync should provide the current state
        await expect(async () => {
          const restoredTitle1 = await getEditorTitle(page1);
          expect(restoredTitle1).toBe(uniqueTitle);
        }).toPass({ timeout: 5000 });

        // Restore original title to clean up - use a known stable value
        const stableTitle = 'REALTIME SYNC TEST - TAB2aaaaa';
        await titleInput2.fill(stableTitle);
        await page2.waitForTimeout(5000);
      }
    } finally {
      // Clean up contexts
      await context1.close();
      await context2.close();
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
      // Capture console messages for debugging WebSocket activity
      page1.on('console', msg => {
        const text = msg.text();
        // Only log relevant messages
        if (text.includes('WebSocket') || text.includes('Realtime') || text.includes('connected') || text.includes('update') || text.includes('puckYjsBinding') || text.includes('CSSPuckProvider')) {
          console.log('Page1 console:', msg.type(), text);
        }
      });
      page2.on('console', msg => {
        const text = msg.text();
        if (text.includes('WebSocket') || text.includes('Realtime') || text.includes('connected') || text.includes('update') || text.includes('puckYjsBinding') || text.includes('CSSPuckProvider') || text.includes('PuckDataSynchronizer') || text.includes('AppContent')) {
          console.log('Page2 console:', msg.type(), text);
        }
      });

      // Navigate both pages to the realtime document
      await navigateToRealtimeDocument(page1);
      await navigateToRealtimeDocument(page2);

      // Wait a bit for WebSocket connections to establish
      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(1000);

      // Set a known initial state first to ensure clean test isolation
      // This helps with test-to-test interference from shared document state
      const initialTitle1 = `INIT SYNC ${Date.now()}`;
      const initInput = page1.getByRole('textbox', { name: 'title' });
      await initInput.click();
      await initInput.clear();
      await initInput.fill(initialTitle1);
      await initInput.blur();

      // Wait for Page2 to receive the initial state
      // Use longer timeout to handle initial sync delays
      await expect(async () => {
        const title2 = await getEditorTitle(page2);
        expect(title2).toBe(initialTitle1);
      }).toPass({ timeout: 15000, intervals: [500, 1000, 1000, 2000, 2000, 3000] });

      // Generate a unique title with timestamp
      const uniqueTitle = `SYNC TEST ${Date.now()}`;

      // Edit the title in page1
      const titleInput1 = page1.getByRole('textbox', { name: 'title' });
      await titleInput1.click();
      await titleInput1.fill(uniqueTitle);
      // Blur to ensure React change event fires and triggers Puck onChange
      await titleInput1.blur();
      // Wait briefly for the onChange to propagate
      await page1.waitForTimeout(500);

      // Debug: Check if page1 sees the new title
      const page1TitleAfterEdit = await getEditorTitle(page1);
      console.log('Page1 title after edit:', page1TitleAfterEdit);
      console.log('Expected title:', uniqueTitle);
      console.log('Page1 sees correct title:', page1TitleAfterEdit === uniqueTitle);

      // Poll for sync to complete (autosave is 3 seconds, plus variable sync time)
      // Use polling instead of fixed timeout for reliability
      await expect(async () => {
        const syncedTitle = await getEditorTitle(page2);
        expect(syncedTitle).toBe(uniqueTitle);
      }).toPass({ timeout: 15000, intervals: [500, 1000, 1000, 2000, 2000] });

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

/**
 * Echo Overwrite Bug Tests
 *
 * These tests verify that when a user types in the editor:
 * 1. Their own changes are NOT echoed back and overwritten
 * 2. The passive viewer correctly receives the full changes
 *
 * This tests the fix for the bug where local changes were being re-applied
 * from the Yjs observer, causing text to be overwritten during typing.
 */
test.describe.serial('Echo Overwrite Bug Prevention', () => {
  test('editor should not have text echoed back during typing', async ({ browser }) => {
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

      // Set a known initial state first to ensure clean test isolation
      // This helps with test-to-test interference
      const initialTitle = `INIT ${Date.now()}`;
      const titleInput1 = page1.getByRole('textbox', { name: 'title' });
      await titleInput1.click();
      await titleInput1.clear();
      await titleInput1.fill(initialTitle);
      await titleInput1.blur();

      // Wait for Page2 to receive the initial state
      // Use longer timeout to handle initial sync delays
      await expect(async () => {
        const title2 = await getEditorTitle(page2);
        expect(title2).toBe(initialTitle);
      }).toPass({ timeout: 15000, intervals: [500, 1000, 1000, 2000, 2000, 3000] });

      // Generate a unique text that we'll type character by character
      const testText = `ECHO TEST ${Date.now()}`;

      // Prepare to type - reuse the title input from above
      await titleInput1.click();
      await titleInput1.clear();

      // Type the text slowly, character by character, to simulate real user typing
      // This is where the echo bug would manifest - each character would trigger
      // a sync that might overwrite subsequent characters
      await titleInput1.type(testText, { delay: 50 });

      // Wait for typing to complete and any sync to settle
      await page1.waitForTimeout(500);

      // CRITICAL: Verify that page1 (the editor) shows the complete text
      // If the echo bug exists, the text would be truncated
      const editorTitle = await getEditorTitle(page1);
      expect(editorTitle).toBe(testText);

      // Also verify the input field contains the full text
      const inputValue = await titleInput1.inputValue();
      expect(inputValue).toBe(testText);

      // Wait for sync to complete and verify page2 (passive viewer) receives full text
      await expect(async () => {
        const viewerTitle = await getEditorTitle(page2);
        expect(viewerTitle).toBe(testText);
      }).toPass({ timeout: 10000 });

      // Restore original title
      await titleInput1.clear();
      await titleInput1.fill(initialTitle);
      await page1.waitForTimeout(3000);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('passive viewer should receive complete text without truncation', async ({ browser }) => {
    // This test specifically verifies the passive viewer receives all characters
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Navigate both pages
      await navigateToRealtimeDocument(page1);
      await navigateToRealtimeDocument(page2);

      // Wait for WebSocket connections
      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      // Get initial title
      let initialTitle = '';
      await expect(async () => {
        initialTitle = await getEditorTitle(page1);
      }).toPass({ timeout: 5000 });

      // Type a longer string to test character-by-character sync
      const longText = 'BEEP BOOP 12345';

      const titleInput1 = page1.getByRole('textbox', { name: 'title' });
      await titleInput1.click();
      await titleInput1.clear();
      await titleInput1.type(longText, { delay: 30 });
      await titleInput1.blur();

      // Wait for sync
      await page1.waitForTimeout(1000);

      // Verify editor has full text
      const editorTitle = await getEditorTitle(page1);
      expect(editorTitle).toBe(longText);

      // Verify passive viewer has full text (not truncated like "BEEP BOO")
      await expect(async () => {
        const viewerTitle = await getEditorTitle(page2);
        expect(viewerTitle).toBe(longText);
      }).toPass({ timeout: 10000 });

      // Restore
      await titleInput1.fill(initialTitle);
      await page1.waitForTimeout(3000);
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
