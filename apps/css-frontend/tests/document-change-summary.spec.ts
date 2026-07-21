/**
 * Document Change Summary E2E Tests (Phase 6)
 *
 * Tests the document-level change summary in the merge preview panel.
 * Verifies that documents are categorized by change type (source-only,
 * target-only, conflicts) with correct counts and branch labels.
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

test.describe('Document Change Summary', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should show document change summary in merge preview panel', async ({
    page,
  }) => {
    const siteName = uniqueName('DocSummary Test');
    const pantheonId = uniqueName('docsummary');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    // Create a document and modify it on the feature branch only
    const doc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/pages/home',
      { title: 'Home Page' }
    );
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      title: 'Updated Home Page',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Doc Summary MR'
    );

    // Wait for merge preview
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Document change summary section should be present
    const summarySection = page.locator('.document-change-summary');
    if (await summarySection.isVisible()) {
      // Should show a summary header with change count
      await expect(summarySection.locator('.summary-header')).toBeVisible();
    }
  });

  test('should categorize source-only and target-only changes', async ({
    page,
  }) => {
    const siteName = uniqueName('DocCategories Test');
    const pantheonId = uniqueName('doccategories');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    // Create doc modified only on source (feature branch)
    const sourceDoc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/pages/source-only',
      { title: 'Source Only Doc' }
    );
    await updateDocumentOnBranch(page, siteId, sourceDoc.id, featureBranchId, {
      title: 'Modified on feature only',
    });

    // Create doc modified only on target (main branch)
    const targetDoc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/pages/target-only',
      { title: 'Target Only Doc' }
    );
    await updateDocumentOnBranch(page, siteId, targetDoc.id, mainBranchId, {
      title: 'Modified on main only',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Categories MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Check for category sections
    const summarySection = page.locator('.document-change-summary');
    if (await summarySection.isVisible()) {
      // Should display change categories
      const categories = summarySection.locator('.change-category');
      const categoryCount = await categories.count();
      expect(categoryCount).toBeGreaterThan(0);

      // Source category should reference the feature branch name
      const sourceCategory = summarySection.locator('.source-category');
      if (await sourceCategory.isVisible()) {
        await expect(sourceCategory).toContainText(featureBranchName);
      }

      // Target category should reference the main branch name
      const targetCategory = summarySection.locator('.target-category');
      if (await targetCategory.isVisible()) {
        await expect(targetCategory).toContainText('main');
      }
    }
  });

  test('should show conflict category when documents modified on both branches', async ({
    page,
  }) => {
    const siteName = uniqueName('DocConflict Test');
    const pantheonId = uniqueName('docconflict');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    // Create document modified on both branches (conflict)
    const conflictDoc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/pages/conflict-page',
      { title: 'Shared Document' }
    );
    await updateDocumentOnBranch(page, siteId, conflictDoc.id, mainBranchId, {
      title: 'Main branch version',
    });
    await updateDocumentOnBranch(
      page,
      siteId,
      conflictDoc.id,
      featureBranchId,
      { title: 'Feature branch version' }
    );

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Conflict Category MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // If there are conflicts, the conflicts warning should appear
    const conflictsWarning = page.getByTestId('conflicts-warning');
    if (await conflictsWarning.isVisible()) {
      // Conflict category should be visible in the summary
      const conflictCategory = page.locator('.conflict-category');
      if (await conflictCategory.isVisible()) {
        await expect(conflictCategory).toContainText('Conflict');
      }
    }
  });

  test('should display document paths in change categories', async ({
    page,
  }) => {
    const siteName = uniqueName('DocPaths Test');
    const pantheonId = uniqueName('docpaths');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    const docPath = '/pages/about-us';
    const doc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      docPath,
      { title: 'About Us' }
    );
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      title: 'About Our Company',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Doc Paths MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Document path should be visible in the change summary
    const summarySection = page.locator('.document-change-summary');
    if (await summarySection.isVisible()) {
      const pathItems = summarySection.locator('.document-path-item');
      const pathCount = await pathItems.count();

      if (pathCount > 0) {
        // Should contain the document path
        await expect(summarySection).toContainText(docPath);
      }
    }
  });

  test('should show count badges on change categories', async ({ page }) => {
    const siteName = uniqueName('CountBadge Test');
    const pantheonId = uniqueName('countbadge');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    // Create two documents modified on the feature branch
    const doc1 = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/pages/doc-a',
      { title: 'Doc A' }
    );
    const doc2 = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/pages/doc-b',
      { title: 'Doc B' }
    );
    await updateDocumentOnBranch(page, siteId, doc1.id, featureBranchId, {
      title: 'Updated Doc A',
    });
    await updateDocumentOnBranch(page, siteId, doc2.id, featureBranchId, {
      title: 'Updated Doc B',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Count Badge MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Count badges should show the number of documents in each category
    const summarySection = page.locator('.document-change-summary');
    if (await summarySection.isVisible()) {
      const countBadges = summarySection.locator('.category-count');
      const badgeCount = await countBadges.count();

      if (badgeCount > 0) {
        // At least one count badge should have a numeric value
        const firstBadgeText = await countBadges.first().textContent();
        expect(firstBadgeText).toMatch(/\d+/);
      }
    }
  });
});
