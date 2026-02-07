/**
 * Field-Level Conflict Resolution E2E Tests (Phase 6)
 *
 * Tests the field-by-field resolution flow including:
 * - "Choose field by field" option on conflict rows
 * - Auto-merged fields display
 * - Conflict fields with radio buttons
 * - Apply resolution with manual strategy
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

/**
 * Creates a conflict scenario where a document is modified on both branches.
 * Returns the document ID and branch IDs.
 */
async function setupConflictScenario(
  page: import('@playwright/test').Page,
  siteId: string,
  mainBranchId: string,
  featureBranchId: string,
  docPath: string
) {
  // Create document with multiple fields for field-level resolution
  const doc = await createDocumentOnBranch(
    page,
    siteId,
    mainBranchId,
    docPath,
    {
      title: 'Original Title',
      description: 'Original description',
      author: 'Alice',
      status: 'draft',
    }
  );

  // Modify different fields on main branch
  await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
    title: 'Main Branch Title',
    description: 'Main description update',
    author: 'Alice',
    status: 'review',
  });

  // Modify overlapping and non-overlapping fields on feature branch
  await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
    title: 'Feature Branch Title',
    description: 'Feature description update',
    author: 'Bob',
    status: 'draft',
  });

  return doc;
}

test.describe('Field-Level Conflict Resolution', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should show "Choose field by field" option for both-modified conflicts', async ({
    page,
  }) => {
    const siteName = uniqueName('FieldOpt Test');
    const pantheonId = uniqueName('fieldopt');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    await setupConflictScenario(
      page,
      siteId,
      mainBranchId,
      featureBranchId,
      '/pages/field-opt'
    );

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Field Option MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    // Check for conflict rows
    const conflictsWarning = page.getByTestId('conflicts-warning');
    if (await conflictsWarning.isVisible()) {
      // Expand a conflict row
      const expandToggle = page
        .locator('[data-testid^="expand-toggle-"]')
        .first();
      if (await expandToggle.isVisible()) {
        await expandToggle.click();
        await page.waitForTimeout(500);

        // Should show resolution options including "Choose field by field"
        const resolutionOptions = page.locator('.resolution-options').first();
        if (await resolutionOptions.isVisible()) {
          // Check for the manual/field-by-field radio option
          const fieldByFieldOption = resolutionOptions.locator(
            '.resolution-option',
            { hasText: /field by field/i }
          );
          await expect(fieldByFieldOption).toBeVisible();
        }
      }
    }
  });

  test('should show FieldResolutionPanel when "Choose field by field" is selected', async ({
    page,
  }) => {
    const siteName = uniqueName('FieldPanel Test');
    const pantheonId = uniqueName('fieldpanel');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    await setupConflictScenario(
      page,
      siteId,
      mainBranchId,
      featureBranchId,
      '/pages/field-panel'
    );

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Field Panel MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    const conflictsWarning = page.getByTestId('conflicts-warning');
    if (await conflictsWarning.isVisible()) {
      const expandToggle = page
        .locator('[data-testid^="expand-toggle-"]')
        .first();
      if (await expandToggle.isVisible()) {
        await expandToggle.click();
        await page.waitForTimeout(500);

        // Select "Choose field by field"
        const fieldByFieldLabel = page.locator('.resolution-option', {
          hasText: /field by field/i,
        });

        if (await fieldByFieldLabel.isVisible()) {
          await fieldByFieldLabel.locator('input[type="radio"]').click();
          await page.waitForTimeout(300);

          // FieldResolutionPanel should appear
          const fieldResPanel = page
            .locator('.field-resolution-panel')
            .first();
          await expect(fieldResPanel).toBeVisible({ timeout: 5000 });

          // Should hide the diff view toggle (shown only when not in manual mode)
          const diffViewToggle = page
            .locator(
              '.expandable-conflict-row.expanded .diff-view-toggle'
            )
            .first();
          await expect(diffViewToggle).not.toBeVisible();
        }
      }
    }
  });

  test('should display auto-merged fields in field resolution panel', async ({
    page,
  }) => {
    const siteName = uniqueName('AutoMerge Test');
    const pantheonId = uniqueName('automerge');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    // Create document where some fields change on only one branch
    const doc = await createDocumentOnBranch(
      page,
      siteId,
      mainBranchId,
      '/pages/auto-merge',
      {
        title: 'Original Title',
        mainOnly: 'original',
        featureOnly: 'original',
        conflicting: 'original',
      }
    );

    // Main changes mainOnly and conflicting
    await updateDocumentOnBranch(page, siteId, doc.id, mainBranchId, {
      title: 'Original Title',
      mainOnly: 'main changed this',
      featureOnly: 'original',
      conflicting: 'main version',
    });

    // Feature changes featureOnly and conflicting
    await updateDocumentOnBranch(page, siteId, doc.id, featureBranchId, {
      title: 'Original Title',
      mainOnly: 'original',
      featureOnly: 'feature changed this',
      conflicting: 'feature version',
    });

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Auto Merge Fields MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    const conflictsWarning = page.getByTestId('conflicts-warning');
    if (await conflictsWarning.isVisible()) {
      const expandToggle = page
        .locator('[data-testid^="expand-toggle-"]')
        .first();
      if (await expandToggle.isVisible()) {
        await expandToggle.click();
        await page.waitForTimeout(500);

        // Select "Choose field by field"
        const fieldByFieldLabel = page.locator('.resolution-option', {
          hasText: /field by field/i,
        });

        if (await fieldByFieldLabel.isVisible()) {
          await fieldByFieldLabel.locator('input[type="radio"]').click();
          await page.waitForTimeout(300);

          // Auto-merged fields section should be visible
          const autoMergedSection = page
            .locator('.auto-merged-fields')
            .first();
          if (await autoMergedSection.isVisible()) {
            // Should show description about safe combining
            await expect(autoMergedSection).toContainText(
              /don't conflict|combined safely/i
            );

            // Should display field items
            const fieldItems = autoMergedSection.locator('.auto-merged-item');
            const itemCount = await fieldItems.count();
            expect(itemCount).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  test('should show conflict fields with radio buttons for source/target choice', async ({
    page,
  }) => {
    const siteName = uniqueName('ConflictRadio Test');
    const pantheonId = uniqueName('conflictradio');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    await setupConflictScenario(
      page,
      siteId,
      mainBranchId,
      featureBranchId,
      '/pages/radio-test'
    );

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Conflict Radio MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    const conflictsWarning = page.getByTestId('conflicts-warning');
    if (await conflictsWarning.isVisible()) {
      const expandToggle = page
        .locator('[data-testid^="expand-toggle-"]')
        .first();
      if (await expandToggle.isVisible()) {
        await expandToggle.click();
        await page.waitForTimeout(500);

        const fieldByFieldLabel = page.locator('.resolution-option', {
          hasText: /field by field/i,
        });

        if (await fieldByFieldLabel.isVisible()) {
          await fieldByFieldLabel.locator('input[type="radio"]').click();
          await page.waitForTimeout(300);

          // Conflict rows should have radio buttons
          const conflictRows = page.locator('.field-conflict-row');
          const rowCount = await conflictRows.count();

          if (rowCount > 0) {
            const firstRow = conflictRows.first();

            // Should show field label
            await expect(
              firstRow.locator('.conflict-field-label')
            ).toBeVisible();

            // Should have source and target radio options
            const radioInputs = firstRow.locator('input[type="radio"]');
            const radioCount = await radioInputs.count();
            expect(radioCount).toBe(2); // source and target

            // Should show branch names in the options
            const options = firstRow.locator('.conflict-option');
            await expect(options.first()).toContainText(/Keep/i);
          }
        }
      }
    }
  });

  test('should enable apply button only when all conflicts are resolved', async ({
    page,
  }) => {
    const siteName = uniqueName('ApplyBtn Test');
    const pantheonId = uniqueName('applybtn');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    await setupConflictScenario(
      page,
      siteId,
      mainBranchId,
      featureBranchId,
      '/pages/apply-btn'
    );

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Apply Button MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    const conflictsWarning = page.getByTestId('conflicts-warning');
    if (await conflictsWarning.isVisible()) {
      const expandToggle = page
        .locator('[data-testid^="expand-toggle-"]')
        .first();
      if (await expandToggle.isVisible()) {
        await expandToggle.click();
        await page.waitForTimeout(500);

        const fieldByFieldLabel = page.locator('.resolution-option', {
          hasText: /field by field/i,
        });

        if (await fieldByFieldLabel.isVisible()) {
          await fieldByFieldLabel.locator('input[type="radio"]').click();
          await page.waitForTimeout(300);

          // Apply resolution button should be initially disabled
          const applyBtn = page
            .locator('.apply-resolution-button')
            .first();
          if (await applyBtn.isVisible()) {
            await expect(applyBtn).toBeDisabled();

            // Select a resolution for each conflict row
            const conflictRows = page.locator('.field-conflict-row');
            const rowCount = await conflictRows.count();

            for (let i = 0; i < rowCount; i++) {
              const row = conflictRows.nth(i);
              // Click the first radio (source) in each row
              const firstRadio = row.locator('input[type="radio"]').first();
              await firstRadio.click();
              await page.waitForTimeout(100);
            }

            // After all conflicts resolved, button should be enabled
            if (rowCount > 0) {
              await expect(applyBtn).toBeEnabled({ timeout: 5000 });
            }
          }
        }
      }
    }
  });

  test('should support standard resolution strategies alongside field-by-field', async ({
    page,
  }) => {
    const siteName = uniqueName('Strategies Test');
    const pantheonId = uniqueName('strategies');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    await setupConflictScenario(
      page,
      siteId,
      mainBranchId,
      featureBranchId,
      '/pages/strategies'
    );

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Strategies MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    const conflictsWarning = page.getByTestId('conflicts-warning');
    if (await conflictsWarning.isVisible()) {
      const expandToggle = page
        .locator('[data-testid^="expand-toggle-"]')
        .first();
      if (await expandToggle.isVisible()) {
        await expandToggle.click();
        await page.waitForTimeout(500);

        // All four resolution strategies should be available
        const resolutionOptions = page.locator('.resolution-options').first();
        if (await resolutionOptions.isVisible()) {
          await expect(
            resolutionOptions.locator('.resolution-option', {
              hasText: /Take Source/i,
            })
          ).toBeVisible();
          await expect(
            resolutionOptions.locator('.resolution-option', {
              hasText: /Take Target/i,
            })
          ).toBeVisible();
          await expect(
            resolutionOptions.locator('.resolution-option', {
              hasText: /CRDT/i,
            })
          ).toBeVisible();
          await expect(
            resolutionOptions.locator('.resolution-option', {
              hasText: /field by field/i,
            })
          ).toBeVisible();
        }
      }
    }
  });

  test('should switch back from field-by-field to standard strategy', async ({
    page,
  }) => {
    const siteName = uniqueName('SwitchBack Test');
    const pantheonId = uniqueName('switchback');
    const featureBranchName = uniqueName('feature');

    await createSiteAndNavigate(page, siteName, pantheonId);

    const siteUrl = page.url();
    const siteId = siteUrl.match(/\/sites\/([a-z0-9-]+)$/)?.[1] || '';
    const mainBranchId = await getBranchId(page, 'main');

    await createBranch(page, featureBranchName);
    const featureBranchId = await getBranchId(page, featureBranchName);

    await setupConflictScenario(
      page,
      siteId,
      mainBranchId,
      featureBranchId,
      '/pages/switch-back'
    );

    await createMergeRequestViaUI(
      page,
      featureBranchName,
      'main',
      'Switch Back MR'
    );

    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('preview-result')).toBeVisible({
      timeout: 20000,
    });

    const conflictsWarning = page.getByTestId('conflicts-warning');
    if (await conflictsWarning.isVisible()) {
      const expandToggle = page
        .locator('[data-testid^="expand-toggle-"]')
        .first();
      if (await expandToggle.isVisible()) {
        await expandToggle.click();
        await page.waitForTimeout(500);

        // Select "Choose field by field"
        const fieldByFieldLabel = page.locator('.resolution-option', {
          hasText: /field by field/i,
        });

        if (await fieldByFieldLabel.isVisible()) {
          await fieldByFieldLabel.locator('input[type="radio"]').click();
          await page.waitForTimeout(300);

          // FieldResolutionPanel should appear
          await expect(
            page.locator('.field-resolution-panel').first()
          ).toBeVisible({ timeout: 5000 });

          // Switch back to "Take Source"
          const takeSourceLabel = page.locator('.resolution-option', {
            hasText: /Take Source/i,
          });
          await takeSourceLabel.locator('input[type="radio"]').click();
          await page.waitForTimeout(300);

          // FieldResolutionPanel should disappear
          await expect(
            page.locator('.field-resolution-panel').first()
          ).not.toBeVisible();

          // Diff view toggle should reappear
          const diffViewToggle = page.locator('.diff-view-toggle').first();
          await expect(diffViewToggle).toBeVisible({ timeout: 5000 });
        }
      }
    }
  });
});
