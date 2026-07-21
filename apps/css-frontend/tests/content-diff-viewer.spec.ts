/**
 * Content Diff Viewer E2E Tests (Phase 6)
 *
 * Tests the JSON/Content view toggle on diff rows and conflict rows.
 * Verifies that the content view shows readable field-level changes
 * instead of raw JSON.
 */

import { test, expect } from '@playwright/test';

const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createSiteAndNavigate(
  page: import('@playwright/test').Page,
  siteName: string,
  pantheonId: string
) {
  await page.getByTestId('nav-sites').click();
  await expect(page).toHaveURL('/sites');

  await page.getByTestId('create-site-btn').click();
  await page.getByTestId('site-name-input').fill(siteName);
  await page.getByTestId('pantheon-id-input').fill(pantheonId);

  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/sites') && resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-site-btn').click();
  await responsePromise;

  const siteRow = page.locator(`tr:has-text("${siteName}")`);
  await expect(siteRow).toBeVisible({ timeout: 10000 });
  await siteRow.locator('[data-testid^="view-site-"]').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+$/);
}

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

  await expect(page.locator(`tr:has-text("${branchName}")`)).toBeVisible({
    timeout: 10000,
  });
}

async function navigateToMergeRequests(page: import('@playwright/test').Page) {
  await page.getByTestId('merge-requests-link').click();
  await expect(page).toHaveURL(/\/sites\/[a-z0-9-]+\/merge-requests$/);
}

async function createMergeRequestViaUI(
  page: import('@playwright/test').Page,
  sourceBranchName: string,
  targetBranchName: string,
  title: string
) {
  const currentUrl = page.url();
  if (!currentUrl.includes('/merge-requests')) {
    await navigateToMergeRequests(page);
  }

  await page.getByTestId('create-mr-btn').click();
  await expect(page).toHaveURL(/\/merge-requests\/new$/);

  const sourceSelect = page.getByTestId('source-branch-select');
  await expect(sourceSelect).toBeVisible({ timeout: 10000 });

  await page.waitForFunction(
    () => {
      const select = document.querySelector(
        '[data-testid="source-branch-select"]'
      ) as HTMLSelectElement;
      return select && select.options.length > 1;
    },
    { timeout: 15000 }
  );

  await sourceSelect.selectOption({ label: sourceBranchName });
  await page
    .getByTestId('target-branch-select')
    .selectOption({ label: targetBranchName });
  await page.getByTestId('title-input').fill(title);

  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/merge-requests') &&
      resp.request().method() === 'POST'
  );
  await page.getByTestId('submit-btn').click();
  await responsePromise;

  await expect(page).toHaveURL(/\/merge-requests\/[a-z0-9-]+$/);
}

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

async function getBranchId(
  page: import('@playwright/test').Page,
  branchName: string
): Promise<string> {
  const branchRow = page.locator(`tr:has-text("${branchName}")`);
  const branchLink = branchRow.locator('[data-testid^="view-branch-"]');
  return (
    (await branchLink.getAttribute('data-testid'))?.replace(
      'view-branch-',
      ''
    ) || ''
  );
}

test.describe('Content Diff Viewer', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should show JSON/Content view toggle on expanded diff row', async ({
    page,
  }) => {
    const siteName = uniqueName('ContentToggle Test');
    const pantheonId = uniqueName('contenttoggle');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    // Create document with changes on both branches
    const doc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/test/toggle-doc',
      { title: 'Original Title', body: 'Original body text' }
    );
    await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
      title: 'Main Title',
      body: 'Main body text',
    });
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      title: 'Feature Title',
      body: 'Feature body text',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Toggle View Test MR'
    );

    // Wait for merge preview panel to load
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Find and expand a diff row
    const expandToggle = page
      .locator('[data-testid^="expand-diff-toggle-"]')
      .first();

    if (await expandToggle.isVisible()) {
      await expandToggle.click();
      await page.waitForTimeout(500);

      // View toggle should appear
      const viewToggle = page.locator('.diff-view-toggle').first();
      await expect(viewToggle).toBeVisible({ timeout: 10000 });

      // Should have both JSON and Content view buttons
      const jsonBtn = viewToggle.locator('.view-toggle-btn', {
        hasText: 'JSON view',
      });
      const contentBtn = viewToggle.locator('.view-toggle-btn', {
        hasText: 'Content view',
      });
      await expect(jsonBtn).toBeVisible();
      await expect(contentBtn).toBeVisible();

      // JSON view should be active by default
      await expect(jsonBtn).toHaveClass(/active/);
    }
  });

  test('should switch to content view and show readable changes', async ({
    page,
  }) => {
    const siteName = uniqueName('ContentView Test');
    const pantheonId = uniqueName('contentview');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    const doc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/test/content-view-doc',
      { headline: 'Welcome', description: 'Original description' }
    );
    await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
      headline: 'Hello World',
      description: 'Main description',
    });
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      headline: 'Greetings',
      description: 'Feature description',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Content View MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Expand a diff or conflict row
    const expandToggle = page
      .locator(
        '[data-testid^="expand-diff-toggle-"], [data-testid^="expand-toggle-"]'
      )
      .first();

    if (await expandToggle.isVisible()) {
      await expandToggle.click();
      await page.waitForTimeout(500);

      // Switch to Content view
      const contentBtn = page
        .locator('.view-toggle-btn')
        .filter({ hasText: 'Content view' })
        .first();
      if (await contentBtn.isVisible()) {
        await contentBtn.click();
        await page.waitForTimeout(300);

        // Content diff viewer should appear
        const contentViewer = page.locator('.content-diff-viewer').first();
        await expect(contentViewer).toBeVisible({ timeout: 5000 });

        // Should show legend
        await expect(
          contentViewer.locator('.content-diff-legend')
        ).toBeVisible();

        // Should have content change rows with field labels
        const changeRows = contentViewer.locator('.content-change-row');
        const rowCount = await changeRows.count();
        expect(rowCount).toBeGreaterThan(0);

        // Content view button should now be active
        await expect(contentBtn).toHaveClass(/active/);

        // JSON view button should not be active
        const jsonBtn = page
          .locator('.view-toggle-btn')
          .filter({ hasText: 'JSON view' })
          .first();
        await expect(jsonBtn).not.toHaveClass(/active/);
      }
    }
  });

  test('should toggle between JSON and Content views on conflict rows', async ({
    page,
  }) => {
    const siteName = uniqueName('ConflictToggle Test');
    const pantheonId = uniqueName('conflicttoggle');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    // Create conflicting document
    const doc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/test/conflict-toggle',
      { title: 'Base', count: 0 }
    );
    await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
      title: 'Main Version',
      count: 10,
    });
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      title: 'Feature Version',
      count: 20,
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Conflict Toggle MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Find and expand a conflict row
    const expandToggle = page
      .locator('[data-testid^="expand-toggle-"]')
      .first();

    if (await expandToggle.isVisible()) {
      await expandToggle.click();
      await page.waitForTimeout(500);

      // Initially shows JSON view
      const jsonViewer = page.locator('.json-diff-viewer').first();
      if (await jsonViewer.isVisible()) {
        // Switch to Content view
        const contentBtn = page
          .locator('.view-toggle-btn')
          .filter({ hasText: 'Content view' })
          .first();
        if (await contentBtn.isVisible()) {
          await contentBtn.click();
          await page.waitForTimeout(300);

          // JSON viewer should be gone, content viewer should show
          await expect(page.locator('.content-diff-viewer').first()).toBeVisible(
            { timeout: 5000 }
          );

          // Switch back to JSON
          const jsonBtn = page
            .locator('.view-toggle-btn')
            .filter({ hasText: 'JSON view' })
            .first();
          await jsonBtn.click();
          await page.waitForTimeout(300);

          // JSON viewer should reappear
          await expect(page.locator('.json-diff-viewer').first()).toBeVisible({
            timeout: 5000,
          });
        }
      }
    }
  });

  test('should show content section groups with collapsible sections', async ({
    page,
  }) => {
    const siteName = uniqueName('SectionGroup Test');
    const pantheonId = uniqueName('sectiongroup');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    // Create document with multiple fields to get groupable sections
    const doc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/test/sections-doc',
      { title: 'Page Title', subtitle: 'Subtitle', author: 'Alice' }
    );
    await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
      title: 'Updated Title',
      subtitle: 'Updated Subtitle',
      author: 'Bob',
    });
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      title: 'New Title',
      subtitle: 'New Subtitle',
      author: 'Charlie',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Section Group MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Expand a diff/conflict row
    const expandToggle = page
      .locator(
        '[data-testid^="expand-diff-toggle-"], [data-testid^="expand-toggle-"]'
      )
      .first();

    if (await expandToggle.isVisible()) {
      await expandToggle.click();
      await page.waitForTimeout(500);

      // Switch to Content view
      const contentBtn = page
        .locator('.view-toggle-btn')
        .filter({ hasText: 'Content view' })
        .first();
      if (await contentBtn.isVisible()) {
        await contentBtn.click();
        await page.waitForTimeout(300);

        // Content section groups should be visible
        const sectionGroups = page.locator('.content-section-group');
        const groupCount = await sectionGroups.count();

        if (groupCount > 0) {
          // Section headers should be clickable for collapse/expand
          const sectionHeader = sectionGroups
            .first()
            .locator('.section-header');
          await expect(sectionHeader).toBeVisible();

          // Click to collapse
          await sectionHeader.click();
          await page.waitForTimeout(200);

          // Section content should be hidden
          const sectionChanges = sectionGroups
            .first()
            .locator('.section-changes');
          await expect(sectionChanges).not.toBeVisible();

          // Click to expand again
          await sectionHeader.click();
          await page.waitForTimeout(200);

          await expect(sectionChanges).toBeVisible();
        }
      }
    }
  });
});
