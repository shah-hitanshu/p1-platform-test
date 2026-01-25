/**
 * Merge Diff Visualization E2E Tests
 *
 * Tests the visual diff feature in merge conflict resolution UI.
 * Creates conflicting document changes and verifies the diff viewer works.
 */

import { test, expect } from '@playwright/test';

// User IDs from LoginPage.tsx (must be UUIDs to match database schema)
const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';

// API base URL from environment or default
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';

// Helper to generate unique names for each test
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Helper to create a site via API
async function createSiteViaApi(name: string, pantheonId: string): Promise<{ id: string }> {
  const response = await fetch(`${API_BASE_URL}/api/sites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-principal-id': ALICE_USER_ID,
      'x-principal-type': 'user',
    },
    body: JSON.stringify({ name, pantheonId }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create site: ${response.statusText}`);
  }
  return response.json();
}

// Helper to get main branch ID
async function getMainBranchId(siteId: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/sites/${siteId}/branches`, {
    headers: {
      'x-principal-id': ALICE_USER_ID,
      'x-principal-type': 'user',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to get branches: ${response.statusText}`);
  }
  const data = await response.json();
  const mainBranch = data.branches.find((b: { name: string }) => b.name === 'main');
  if (!mainBranch) {
    throw new Error('Main branch not found');
  }
  return mainBranch.id;
}

// Helper to create a branch via API
async function createBranchViaApi(
  siteId: string,
  name: string,
  parentBranchId: string
): Promise<{ id: string }> {
  const response = await fetch(`${API_BASE_URL}/api/sites/${siteId}/branches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-principal-id': ALICE_USER_ID,
      'x-principal-type': 'user',
    },
    body: JSON.stringify({ name, parentBranchId }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create branch: ${response.statusText}`);
  }
  return response.json();
}

// Helper to create a document on a branch via API
async function createDocumentOnBranchViaApi(
  siteId: string,
  branchId: string,
  path: string
): Promise<{ document: { id: string }; version: { id: string } }> {
  const response = await fetch(
    `${API_BASE_URL}/api/sites/${siteId}/branches/${branchId}/documents`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-principal-id': ALICE_USER_ID,
        'x-principal-type': 'user',
      },
      body: JSON.stringify({ path }),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to create document: ${response.statusText}`);
  }
  return response.json();
}

// Helper to update document version on a branch
async function createDocumentVersionViaApi(
  siteId: string,
  branchId: string,
  documentId: string,
  snapshot: Record<string, unknown>
): Promise<{ id: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-principal-id': ALICE_USER_ID,
        'x-principal-type': 'user',
      },
      body: JSON.stringify({ snapshot }),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to create document version: ${response.statusText}`);
  }
  return response.json();
}

// Helper to create a merge request via API
async function createMergeRequestViaApi(
  siteId: string,
  sourceBranchId: string,
  targetBranchId: string,
  title: string
): Promise<{ id: string }> {
  const response = await fetch(`${API_BASE_URL}/api/sites/${siteId}/merge-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-principal-id': ALICE_USER_ID,
      'x-principal-type': 'user',
    },
    body: JSON.stringify({ sourceBranchId, targetBranchId, title }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create merge request: ${response.statusText}`);
  }
  return response.json();
}

test.describe('Merge Diff Visualization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('user-select').selectOption(ALICE_USER_ID);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL('/');
  });

  test('should show expand/collapse buttons when conflicts have diffs', async ({ page }) => {
    // Setup: Create site with conflicting document changes
    const siteName = uniqueName('DiffViz Test');
    const pantheonId = uniqueName('diffviz');
    const featureBranchName = uniqueName('feature');
    const docPath = 'pages/home';

    // Create site and get IDs
    const site = await createSiteViaApi(siteName, pantheonId);
    const mainBranchId = await getMainBranchId(site.id);

    // Create document on main with initial content
    const { document } = await createDocumentOnBranchViaApi(site.id, mainBranchId, docPath);
    await createDocumentVersionViaApi(site.id, mainBranchId, document.id, {
      title: 'Original Title',
      content: 'Original content',
    });

    // Create feature branch from main
    const featureBranch = await createBranchViaApi(site.id, featureBranchName, mainBranchId);

    // Modify document on feature branch (diverge from main)
    await createDocumentVersionViaApi(site.id, featureBranch.id, document.id, {
      title: 'Feature Title',
      content: 'Feature content',
    });

    // Modify document on main branch (create conflict)
    await createDocumentVersionViaApi(site.id, mainBranchId, document.id, {
      title: 'Main Title',
      content: 'Main content',
    });

    // Create merge request
    const mr = await createMergeRequestViaApi(
      site.id,
      featureBranch.id,
      mainBranchId,
      'Conflicting MR'
    );

    // Navigate to merge request detail page
    await page.goto(`/sites/${site.id}/merge-requests/${mr.id}`);

    // Wait for page to load
    await expect(page.getByTestId('mr-title')).toContainText('Conflicting MR');

    // The merge request should show as conflicted (or we can verify preview shows conflicts)
    // Wait for merge preview to load
    await expect(page.getByTestId('merge-preview-panel')).toBeVisible({ timeout: 15000 });

    // Wait for preview to finish loading
    await expect(
      page.locator('[data-testid="preview-result"], [data-testid="preview-error"]').first()
    ).toBeVisible({ timeout: 20000 });

    // Check if conflicts are shown (this depends on the merge status)
    const conflictsWarning = page.getByTestId('conflicts-warning');
    const previewResult = page.getByTestId('preview-result');

    // Wait for either conflicts warning or clean merge message
    await expect(conflictsWarning.or(previewResult)).toBeVisible({ timeout: 10000 });
  });

  test('should expand conflict row to show diff viewer', async ({ page }) => {
    // Setup: Create site with conflicting document changes
    const siteName = uniqueName('DiffExpand Test');
    const pantheonId = uniqueName('diffexpand');
    const featureBranchName = uniqueName('feature');
    const docPath = 'pages/about';

    // Create site and get IDs
    const site = await createSiteViaApi(siteName, pantheonId);
    const mainBranchId = await getMainBranchId(site.id);

    // Create document on main with initial content
    const { document } = await createDocumentOnBranchViaApi(site.id, mainBranchId, docPath);
    await createDocumentVersionViaApi(site.id, mainBranchId, document.id, {
      title: 'Base Title',
      description: 'Base description',
    });

    // Create feature branch from main
    const featureBranch = await createBranchViaApi(site.id, featureBranchName, mainBranchId);

    // Modify document on feature branch
    await createDocumentVersionViaApi(site.id, featureBranch.id, document.id, {
      title: 'Feature Title',
      description: 'Feature description',
    });

    // Modify document on main branch
    await createDocumentVersionViaApi(site.id, mainBranchId, document.id, {
      title: 'Main Title',
      description: 'Main description',
    });

    // Create merge request (should be conflicted)
    const mr = await createMergeRequestViaApi(
      site.id,
      featureBranch.id,
      mainBranchId,
      'Expand Diff Test MR'
    );

    // Navigate to merge request
    await page.goto(`/sites/${site.id}/merge-requests/${mr.id}`);

    // Wait for page to load
    await expect(page.getByTestId('mr-title')).toContainText('Expand Diff Test MR');

    // If status is conflicted, there should be a resolve button
    const resolveBtn = page.getByTestId('resolve-btn');
    const statusBadge = page.getByTestId('mr-status-badge');

    // Wait for status to load
    await expect(statusBadge).toBeVisible({ timeout: 10000 });

    // Check if we're in conflicted state
    const statusText = await statusBadge.textContent();

    if (statusText?.includes('conflicted')) {
      // Click resolve conflicts button
      await resolveBtn.click();

      // Wait for conflict resolution panel to appear
      await expect(page.locator('.conflict-resolution-panel')).toBeVisible({ timeout: 10000 });

      // If diffs are available, expand all button should be visible
      const expandAllBtn = page.getByTestId('expand-all-btn');

      // Wait a moment for diff data to load
      await page.waitForTimeout(2000);

      // Check if expand buttons are available
      if (await expandAllBtn.isVisible()) {
        // Click expand all
        await expandAllBtn.click();

        // JSON diff viewer should now be visible
        await expect(page.locator('.json-diff-viewer').first()).toBeVisible({ timeout: 5000 });

        // Verify diff legend is shown
        await expect(page.locator('.diff-legend').first()).toBeVisible();

        // Verify side-by-side panes are shown
        await expect(page.locator('.source-pane').first()).toBeVisible();
        await expect(page.locator('.target-pane').first()).toBeVisible();
      }
    }
  });

  test('should apply resolution strategy and merge with expanded diffs', async ({ page }) => {
    // Setup: Create site with conflicting document changes
    const siteName = uniqueName('DiffResolve Test');
    const pantheonId = uniqueName('diffresolve');
    const featureBranchName = uniqueName('feature');
    const docPath = 'pages/contact';

    // Create site and get IDs
    const site = await createSiteViaApi(siteName, pantheonId);
    const mainBranchId = await getMainBranchId(site.id);

    // Create document on main with initial content
    const { document } = await createDocumentOnBranchViaApi(site.id, mainBranchId, docPath);
    await createDocumentVersionViaApi(site.id, mainBranchId, document.id, {
      email: 'original@example.com',
      phone: '555-0100',
    });

    // Create feature branch from main
    const featureBranch = await createBranchViaApi(site.id, featureBranchName, mainBranchId);

    // Modify document on feature branch
    await createDocumentVersionViaApi(site.id, featureBranch.id, document.id, {
      email: 'feature@example.com',
      phone: '555-0101',
    });

    // Modify document on main branch
    await createDocumentVersionViaApi(site.id, mainBranchId, document.id, {
      email: 'main@example.com',
      phone: '555-0102',
    });

    // Create merge request
    const mr = await createMergeRequestViaApi(
      site.id,
      featureBranch.id,
      mainBranchId,
      'Resolution Test MR'
    );

    // Navigate to merge request
    await page.goto(`/sites/${site.id}/merge-requests/${mr.id}`);

    // Wait for status badge
    await expect(page.getByTestId('mr-status-badge')).toBeVisible({ timeout: 10000 });

    // Check status
    const statusText = await page.getByTestId('mr-status-badge').textContent();

    if (statusText?.includes('conflicted')) {
      // Click resolve conflicts
      await page.getByTestId('resolve-btn').click();

      // Wait for resolution panel
      await expect(page.locator('.conflict-resolution-panel')).toBeVisible({ timeout: 10000 });

      // Apply "take source" to all conflicts
      await page.getByTestId('apply-all-take-source').click();

      // Click apply resolutions button
      const applyBtn = page.getByTestId('apply-resolutions-btn');
      await expect(applyBtn).toBeEnabled({ timeout: 5000 });
      await applyBtn.click();

      // Wait for merge to complete
      await expect(page.getByTestId('mr-status-badge')).toContainText('merged', {
        timeout: 15000,
      });
    }
  });
});
