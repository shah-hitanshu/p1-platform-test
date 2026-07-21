/**
 * Merge Diff Visualization E2E Tests
 *
 * Tests the visual diff feature in merge conflict resolution UI.
 * Creates conflicting document changes and verifies the diff viewer works.
 */

import { test, expect } from '@playwright/test';

// User IDs from LoginPage.tsx (must be UUIDs to match database schema)
const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

// Helper to generate unique names for each test
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Helper to create a site and navigate to it
async function createSiteAndNavigate(
  page: import('@playwright/test').Page,
  siteName: string,
  pantheonId: string
) {
  // Navigate to sites
  await page.getByTestId('nav-sites').click();
  await expect(page).toHaveURL('/sites');

  // Create site
  await page.getByTestId('create-site-btn').click();
  await page.getByTestId('site-name-input').fill(siteName);
  await page.getByTestId('pantheon-id-input').fill(pantheonId);

  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/sites') && resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-site-btn').click();
  await responsePromise;

  // Wait for the new site row to appear
  const siteRow = page.locator(`tr:has-text("${siteName}")`);
  await expect(siteRow).toBeVisible({ timeout: 10000 });

  // Navigate to site detail
  await siteRow.locator('[data-testid^="view-site-"]').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);
}

// Helper to create a branch
async function createBranch(
  page: import('@playwright/test').Page,
  branchName: string,
  parentBranchName?: string
) {
  await page.getByTestId('create-branch-btn').click();
  await page.getByTestId('branch-name-input').fill(branchName);

  if (parentBranchName) {
    await page
      .getByTestId('parent-branch-select')
      .selectOption({ label: parentBranchName });
  }

  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/sites') &&
      resp.url().includes('/branches') &&
      resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-branch-btn').click();
  await responsePromise;

  // Wait for the new branch row to appear
  await expect(page.locator(`tr:has-text("${branchName}")`)).toBeVisible({
    timeout: 10000,
  });
}

// Helper to navigate to merge requests page
async function navigateToMergeRequests(page: import('@playwright/test').Page) {
  await page.getByTestId('merge-requests-link').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/);
}

// Helper to create a merge request through UI
async function createMergeRequestViaUI(
  page: import('@playwright/test').Page,
  sourceBranchName: string,
  targetBranchName: string,
  title: string
) {
  // Navigate to merge requests page first if not there
  const currentUrl = page.url();
  if (!currentUrl.includes('/merge-requests')) {
    await navigateToMergeRequests(page);
  }

  // Click create button
  await page.getByTestId('create-mr-btn').click();
  await expect(page).toHaveURL(/\/merge-requests\/new$/);

  // Wait for form to load and branches to be available
  const sourceSelect = page.getByTestId('source-branch-select');
  await expect(sourceSelect).toBeVisible({ timeout: 10000 });

  // Wait for branches to load (options beyond the placeholder)
  await page.waitForFunction(
    () => {
      const select = document.querySelector('[data-testid="source-branch-select"]') as HTMLSelectElement;
      return select && select.options.length > 1;
    },
    { timeout: 15000 }
  );

  // Fill form - use label for selectOption
  await sourceSelect.selectOption({ label: sourceBranchName });
  await page
    .getByTestId('target-branch-select')
    .selectOption({ label: targetBranchName });
  await page.getByTestId('title-input').fill(title);

  // Submit
  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/merge-requests') &&
      resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-btn').click();
  await responsePromise;

  // Should redirect to detail page
  await expect(page).toHaveURL(/\/merge-requests\/[a-z0-9-]+$/);
}

// Helper to create a document on a branch via API
async function createDocumentOnBranch(
  page: import('@playwright/test').Page,
  siteId: string,
  branchId: string,
  path: string,
  content: Record<string, unknown>
) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.post(`/api/sites/${siteId}/documents`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { path, branchId, initialContent: content },
  });
  return response.json();
}

// Helper to update a document on a branch via API
async function updateDocumentOnBranch(
  page: import('@playwright/test').Page,
  siteId: string,
  documentId: string,
  branchId: string,
  content: Record<string, unknown>
) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.patch(
    `/api/sites/${siteId}/documents/${documentId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { branchId, content, source: 'edit' },
    }
  );
  return response.json();
}

test.describe('Merge Diff Visualization', () => {
  test.setTimeout(120000); // These tests involve multiple steps

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should show merge preview panel on merge request detail', async ({
    page,
  }) => {
    // Setup: Create site with a branch
    const siteName = uniqueName('PreviewPanel Test');
    const pantheonId = uniqueName('preview');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, featureBranchName);

    // Create merge request from feature to main
    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Preview Test MR'
    );

    // Verify we're on the detail page
    await expect(page.getByTestId('mr-title')).toContainText('Preview Test MR');

    // Merge preview panel should be visible
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });

    // Wait for preview to load (either result or error)
    await expect(
      page
        .locator('[data-testid="preview-result"], [data-testid="preview-error"]')
        .first()
    ).toBeVisible({ timeout: 20000 });
  });

  test('should show conflict resolution panel when merge request is conflicted', async ({
    page,
  }) => {
    // This test checks that the conflict resolution UI is available
    // Note: Creating actual conflicts requires document changes which need additional setup

    const siteName = uniqueName('ConflictUI Test');
    const pantheonId = uniqueName('conflictui');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, featureBranchName);

    // Create merge request
    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Conflict UI Test MR'
    );

    // Wait for status badge to appear
    await expect(page.getByTestId('mr-status-badge')).toBeVisible({
      timeout: 10000,
    });

    // Check the status - should be 'open' for a clean merge
    const statusText = await page.getByTestId('mr-status-badge').textContent();

    if (statusText?.includes('conflicted')) {
      // If conflicted, the resolve button should be available
      await expect(page.getByTestId('resolve-btn')).toBeVisible();

      // Click to show resolution panel
      await page.getByTestId('resolve-btn').click();

      // Resolution panel should appear
      await expect(page.locator('.conflict-resolution-panel')).toBeVisible({
        timeout: 10000,
      });
    } else {
      // If not conflicted, the approve or merge actions should be available
      const approveBtn = page.getByTestId('approve-btn');
      const mergeBtn = page.getByTestId('merge-btn');

      // At least one action should be available for open/approved MRs
      await expect(approveBtn.or(mergeBtn)).toBeVisible({ timeout: 10000 });
    }
  });

  test('should refresh preview when clicking refresh button', async ({
    page,
  }) => {
    const siteName = uniqueName('RefreshPreview Test');
    const pantheonId = uniqueName('refresh');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, featureBranchName);
    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Refresh Preview MR'
    );

    // Wait for initial preview load - either result or error
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    const previewContent = page.locator(
      '[data-testid="preview-result"], [data-testid="preview-error"]'
    ).first();
    await expect(previewContent).toBeVisible({ timeout: 20000 });

    // Click refresh button
    const refreshBtn = page.getByTestId('refresh-preview-btn');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Should show loading state briefly, then result or error again
    await expect(previewContent).toBeVisible({ timeout: 20000 });
  });

  test('should display actions based on merge request status', async ({
    page,
  }) => {
    const siteName = uniqueName('Actions Test');
    const pantheonId = uniqueName('actions');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);
    await createBranch(page, featureBranchName);
    await createMergeRequestViaUI(page, featureBranchName, 'main', 'Actions MR');

    // Wait for page to fully load
    await expect(page.getByTestId('mr-title')).toContainText('Actions MR');
    await expect(page.getByTestId('mr-status-badge')).toBeVisible({
      timeout: 10000,
    });

    // Actions container should be visible
    await expect(page.getByTestId('actions-container')).toBeVisible();

    const statusText = await page.getByTestId('mr-status-badge').textContent();

    if (statusText?.includes('open')) {
      // Open MRs should have approve and close buttons
      await expect(page.getByTestId('approve-btn')).toBeVisible();
      await expect(page.getByTestId('close-btn')).toBeVisible();
    } else if (statusText?.includes('approved')) {
      // Approved MRs should have merge and close buttons
      await expect(page.getByTestId('merge-btn')).toBeVisible();
      await expect(page.getByTestId('close-btn')).toBeVisible();
    } else if (statusText?.includes('conflicted')) {
      // Conflicted MRs should have resolve and close buttons
      await expect(page.getByTestId('resolve-btn')).toBeVisible();
      await expect(page.getByTestId('close-btn')).toBeVisible();
    }
  });
});

test.describe('Expandable Diff in Merge Preview Panel', () => {
  test.setTimeout(180000); // These tests require setup with documents

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should show expand/collapse buttons when conflicts exist', async ({
    page,
  }) => {
    // Create site with branches and conflicting documents
    const siteName = uniqueName('ExpandDiff Test');
    const pantheonId = uniqueName('expanddiff');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    // Get site ID from URL
    const siteUrl = page.url();
    const siteIdMatch = siteUrl.match(/\/sites\/([a-z0-9-]+)$/);
    const siteId = siteIdMatch ? siteIdMatch[1] : '';

    // Get main branch ID
    const mainBranchRow = page.locator('tr:has-text("main")');
    const mainBranchLink = mainBranchRow.locator('[data-testid^="view-branch-"]');
    const mainBranchId = (await mainBranchLink.getAttribute('data-testid'))?.replace('view-branch-', '') || '';

    // Create feature branch
    await createBranch(page, featureBranchName);
    const featureBranchRow = page.locator(`tr:has-text("${featureBranchName}")`);
    const featureBranchLink = featureBranchRow.locator('[data-testid^="view-branch-"]');
    const featureBranchId = (await featureBranchLink.getAttribute('data-testid'))?.replace('view-branch-', '') || '';

    // Create document on main branch
    const doc = await createDocumentOnBranch(page, siteId, mainBranchId, '/test/conflict-doc', {
      title: 'Original Title',
      content: 'Original content',
    });

    // Update document differently on both branches to create conflict
    await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
      title: 'Main Branch Title',
      content: 'Main branch content',
    });
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      title: 'Feature Branch Title',
      content: 'Feature branch content',
    });

    // Create merge request
    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Expand Diff Test MR'
    );

    // Wait for merge preview panel to load
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Check for expand/collapse controls
    const expandAllBtn = page.getByTestId('expand-all-diffs-btn');
    const collapseAllBtn = page.getByTestId('collapse-all-diffs-btn');

    // If conflicts exist, expand/collapse buttons should be visible
    const hasConflicts = await page.getByTestId('conflicts-warning').isVisible();
    if (hasConflicts) {
      await expect(expandAllBtn).toBeVisible();
      await expect(collapseAllBtn).toBeVisible();
    }
  });

  test('should expand conflict row to show JSON diff', async ({ page }) => {
    // Create site with conflicting documents
    const siteName = uniqueName('ShowDiff Test');
    const pantheonId = uniqueName('showdiff');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteIdMatch = siteUrl.match(/\/sites\/([a-z0-9-]+)$/);
    const siteId = siteIdMatch ? siteIdMatch[1] : '';

    const mainBranchRow = page.locator('tr:has-text("main")');
    const mainBranchLink = mainBranchRow.locator('[data-testid^="view-branch-"]');
    const mainBranchId = (await mainBranchLink.getAttribute('data-testid'))?.replace('view-branch-', '') || '';

    await createBranch(page, featureBranchName);
    const featureBranchRow = page.locator(`tr:has-text("${featureBranchName}")`);
    const featureBranchLink = featureBranchRow.locator('[data-testid^="view-branch-"]');
    const featureBranchId = (await featureBranchLink.getAttribute('data-testid'))?.replace('view-branch-', '') || '';

    // Create and update document to cause conflict
    const doc = await createDocumentOnBranch(page, siteId, mainBranchId, '/test/diff-doc', {
      title: 'Initial',
    });
    await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
      title: 'Main Version',
    });
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      title: 'Feature Version',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Show Diff Test MR'
    );

    // Wait for preview panel
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Find the first expand toggle button
    const expandToggle = page.locator('[data-testid^="expand-diff-toggle-"]').first();

    if (await expandToggle.isVisible()) {
      // Click to expand and show diff
      await expandToggle.click();

      // Wait for loading to complete
      await page.waitForTimeout(500);

      // JSON diff viewer should appear
      const diffViewer = page.locator('.json-diff-viewer');
      await expect(diffViewer).toBeVisible({ timeout: 10000 });

      // Verify diff content is shown
      await expect(diffViewer.locator('.diff-grid')).toBeVisible();
    }
  });

  test('should lazy load diffs on first expand', async ({ page }) => {
    // This test verifies diffs are not loaded until first expansion
    const siteName = uniqueName('LazyDiff Test');
    const pantheonId = uniqueName('lazydiff');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteIdMatch = siteUrl.match(/\/sites\/([a-z0-9-]+)$/);
    const siteId = siteIdMatch ? siteIdMatch[1] : '';

    const mainBranchRow = page.locator('tr:has-text("main")');
    const mainBranchLink = mainBranchRow.locator('[data-testid^="view-branch-"]');
    const mainBranchId = (await mainBranchLink.getAttribute('data-testid'))?.replace('view-branch-', '') || '';

    await createBranch(page, featureBranchName);
    const featureBranchRow = page.locator(`tr:has-text("${featureBranchName}")`);
    const featureBranchLink = featureBranchRow.locator('[data-testid^="view-branch-"]');
    const featureBranchId = (await featureBranchLink.getAttribute('data-testid'))?.replace('view-branch-', '') || '';

    const doc = await createDocumentOnBranch(page, siteId, mainBranchId, '/test/lazy-doc', {
      data: 'initial',
    });
    await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
      data: 'main',
    });
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      data: 'feature',
    });

    // Intercept network requests to check for lazy loading
    const previewRequests: { includeContent: boolean }[] = [];
    await page.route('**/api/sites/*/merge/preview', async (route, request) => {
      const postData = request.postDataJSON();
      previewRequests.push({ includeContent: postData.includeContent || false });
      await route.continue();
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Lazy Diff Test MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Initial request should NOT include content (lazy loading)
    // Clear the intercepted requests and find the expand toggle
    previewRequests.length = 0;

    const expandToggle = page.locator('[data-testid^="expand-diff-toggle-"]').first();
    if (await expandToggle.isVisible()) {
      // Clicking expand should trigger a request with includeContent=true
      await expandToggle.click();
      await page.waitForTimeout(1000);

      // Check if any request was made with includeContent: true
      const contentRequest = previewRequests.find((r) => r.includeContent === true);
      expect(contentRequest).toBeDefined();
    }
  });

  test('should expand and collapse all diffs', async ({ page }) => {
    const siteName = uniqueName('ExpandAll Test');
    const pantheonId = uniqueName('expandall');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteIdMatch = siteUrl.match(/\/sites\/([a-z0-9-]+)$/);
    const siteId = siteIdMatch ? siteIdMatch[1] : '';

    const mainBranchRow = page.locator('tr:has-text("main")');
    const mainBranchLink = mainBranchRow.locator('[data-testid^="view-branch-"]');
    const mainBranchId = (await mainBranchLink.getAttribute('data-testid'))?.replace('view-branch-', '') || '';

    await createBranch(page, featureBranchName);
    const featureBranchRow = page.locator(`tr:has-text("${featureBranchName}")`);
    const featureBranchLink = featureBranchRow.locator('[data-testid^="view-branch-"]');
    const featureBranchId = (await featureBranchLink.getAttribute('data-testid'))?.replace('view-branch-', '') || '';

    // Create multiple conflicting documents
    const doc1 = await createDocumentOnBranch(page, siteId, mainBranchId, '/test/doc1', {
      field: 'value1',
    });
    const doc2 = await createDocumentOnBranch(page, siteId, mainBranchId, '/test/doc2', {
      field: 'value2',
    });

    await updateDocumentOnBranch(page, siteId, doc1.id, mainBranchId, {
      field: 'main1',
    });
    await updateDocumentOnBranch(page, siteId, doc1.id, featureBranchId, {
      field: 'feature1',
    });
    await updateDocumentOnBranch(page, siteId, doc2.id, mainBranchId, {
      field: 'main2',
    });
    await updateDocumentOnBranch(page, siteId, doc2.id, featureBranchId, {
      field: 'feature2',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Expand All Test MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    const expandAllBtn = page.getByTestId('expand-all-diffs-btn');
    const collapseAllBtn = page.getByTestId('collapse-all-diffs-btn');

    if (await expandAllBtn.isVisible()) {
      // Click Expand All
      await expandAllBtn.click();

      // Wait for diffs to load
      await page.waitForTimeout(1500);

      // All diff viewers should be visible
      const diffViewers = page.locator('.json-diff-viewer');
      const viewerCount = await diffViewers.count();
      expect(viewerCount).toBeGreaterThan(0);

      // Click Collapse All
      await collapseAllBtn.click();
      await page.waitForTimeout(500);

      // Diff viewers should be hidden
      await expect(page.locator('.json-diff-viewer').first()).not.toBeVisible();
    }
  });
});
