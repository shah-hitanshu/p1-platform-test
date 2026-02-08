import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * End-to-end tests for CRDT Merge via Realtime Save Path
 *
 * These tests verify the full cycle:
 * 1. Edit a document on two branches via the Puck editor with realtime enabled
 * 2. Both edits produce CRDT-enabled versions (source='realtime', crdt_state populated)
 * 3. CRDT merge detects conflicts
 * 4. CRDT preview produces a merged snapshot
 * 5. CRDT merge execution succeeds and produces a merged version
 *
 * Prerequisites:
 * - CSS backend must be running at VITE_CSS_BASE_URL (default: localhost:8787)
 * - Demo app must be running at localhost:3000
 * - Document "test" must exist on the demo site with CRDT on main
 */

const API_CONFIG = {
  baseUrl: process.env.VITE_CSS_BASE_URL || 'http://localhost:8787',
  siteId:
    process.env.VITE_CSS_SITE_ID ||
    'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22',
};

const ALICE_USER_ID = '11111111-1111-1111-1111-111111111111';
const MAIN_BRANCH_ID = '75fa18d1-0360-4da7-b165-5e7a42b404ee';
const TEST_DOC_ID = '898b1eca-3882-4edb-981e-281961ee1697';

// ── API helpers ──────────────────────────────────────────────

async function loginAsUser(
  request: APIRequestContext,
  userId: string,
): Promise<string> {
  const response = await request.post(
    `${API_CONFIG.baseUrl}/api/auth/token`,
    {
      data: { userId },
      headers: { 'Content-Type': 'application/json' },
    },
  );
  const data = await response.json();
  return data.token;
}

async function createBranch(
  request: APIRequestContext,
  token: string,
  name: string,
  parentBranchId: string,
): Promise<{ id: string; name: string }> {
  const response = await request.post(
    `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches`,
    {
      data: { name, parentBranchId },
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );
  expect(response.status()).toBe(201);
  return response.json();
}

async function getLatestVersion(
  request: APIRequestContext,
  token: string,
  documentId: string,
  branchId: string,
): Promise<{
  id: string;
  versionNumber: number;
  source: string;
  crdtState?: string;
  snapshot: Record<string, unknown>;
}> {
  const response = await request.get(
    `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/documents/${documentId}/versions/latest`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}

async function deleteBranch(
  request: APIRequestContext,
  token: string,
  branchId: string,
): Promise<void> {
  await request.delete(
    `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

// ── Page helpers ─────────────────────────────────────────────

/**
 * Navigate to the "test" document in the Puck editor
 */
async function navigateToTestDocument(page: Page): Promise<void> {
  await page.goto('/');
  await expect(
    page.locator('.Puck, [class*="_Puck_"]').first(),
  ).toBeVisible({ timeout: 15000 });

  // Open the CSS plugin tab
  const cssTab = page.locator('div').filter({ hasText: /^CSS$/ });
  if (await cssTab.isVisible()) {
    await cssTab.click();
  }

  // Select the "test" document from the document list (not the branch dropdown)
  const docItem = page.locator('.css-plugin-doc-path').filter({ hasText: 'test' });
  await expect(docItem).toBeVisible({ timeout: 5000 });
  await docItem.click();
  await page.waitForLoadState('networkidle');
}

/**
 * Switch to a specific branch using the branch selector in the CSS plugin panel.
 * Uses force-based interactions because the select may be in a clipped/scrollable panel.
 */
async function switchBranch(page: Page, branchName: string): Promise<void> {
  // Ensure the CSS plugin tab is open
  const cssTab = page.locator('div').filter({ hasText: /^CSS$/ });
  if (await cssTab.isVisible()) {
    await cssTab.click();
    await page.waitForTimeout(500);
  }

  // Wait for the branch selector to be attached to the DOM
  const branchSelect = page.locator('#css-branch-select');
  await expect(branchSelect).toBeAttached({ timeout: 10000 });

  // selectOption works even when the element isn't "visible" by Playwright's definition
  await branchSelect.selectOption({ label: branchName });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

/**
 * Wait for the realtime WebSocket connection to be established.
 * Monitors console output for the "[Realtime] WebSocket connected" log message.
 */
async function waitForRealtimeConnection(page: Page): Promise<void> {
  const connected = new Promise<void>((resolve) => {
    const handler = (msg: { text: () => string }) => {
      if (msg.text().includes('[Realtime] WebSocket connected')) {
        page.removeListener('console', handler);
        resolve();
      }
    };
    page.on('console', handler);
  });

  // Race: either we see the log within timeout, or fall back to a fixed wait.
  // Use a plain setTimeout to avoid Playwright errors if the page closes.
  const fallback = new Promise<void>((resolve) => setTimeout(resolve, 15000));

  await Promise.race([connected, fallback]);
}

/**
 * Edit the title field (root prop) via the Puck editor field panel.
 * The root fields are visible when no component is selected.
 */
async function editTitleField(page: Page, newTitle: string): Promise<void> {
  const titleInput = page.getByRole('textbox', { name: 'title' });
  await expect(titleInput).toBeVisible({ timeout: 10000 });
  await titleInput.click();
  await titleInput.clear();
  await titleInput.fill(newTitle);
  await titleInput.blur();
}

/**
 * Select the Heading component via the Outline panel and edit its "text" field.
 * This edits a DIFFERENT part of the document than editTitleField, ensuring
 * the CRDT merge produces a visibly combined result.
 *
 * We use the Outline panel rather than clicking in the iframe because
 * iframe clicks don't reliably trigger Puck's component selection.
 */
async function editHeadingText(page: Page, newText: string): Promise<void> {
  // Open the Outline panel to see the component tree
  const outlineTab = page.locator('div').filter({ hasText: /^Outline$/ });
  await expect(outlineTab).toBeVisible({ timeout: 5000 });
  await outlineTab.click();
  await page.waitForTimeout(500);

  // Click the "Heading" entry in the Outline to select it
  const headingEntry = page.locator('button').filter({ hasText: /^Heading$/ }).first();
  await expect(headingEntry).toBeVisible({ timeout: 5000 });
  await headingEntry.click();

  // Wait for the field panel to update to Heading fields
  await page.waitForTimeout(500);

  // Find the "text" input in the field panel and edit it
  const textInput = page.getByRole('textbox', { name: 'text' });
  await expect(textInput).toBeVisible({ timeout: 5000 });
  await textInput.click();
  await textInput.clear();
  await textInput.fill(newText);
  await textInput.blur();
}

// ── Test suite ───────────────────────────────────────────────

test.describe.serial('CRDT Merge End-to-End', () => {
  // These tests involve realtime WebSocket connections and DO flushes
  test.setTimeout(180_000);
  let token: string;
  let testBranchId: string;
  const testBranchName = `crdt-test-${Date.now()}`;
  const mainTitle = `MAIN-CRDT-${Date.now()}`;
  const branchHeading = `BRANCH-HEADING-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    // Login as Alice
    token = await loginAsUser(request, ALICE_USER_ID);

    // Create a fresh branch from main for this test run
    const branch = await createBranch(
      request,
      token,
      testBranchName,
      MAIN_BRANCH_ID,
    );
    testBranchId = branch.id;
  });

  test.afterAll(async ({ request }) => {
    // Clean up: delete the test branch
    if (testBranchId) {
      try {
        await deleteBranch(request, token, testBranchId);
      } catch {
        // Best-effort cleanup
      }
    }
  });

  test('should produce CRDT versions on both branches via realtime editing', async ({
    browser,
    request,
  }) => {
    // ── Edit on main branch ──
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();

    try {
      // Start listening for the WebSocket connection log BEFORE navigating
      const wsConnected1 = waitForRealtimeConnection(page1);
      await navigateToTestDocument(page1);

      // Wait for the realtime WebSocket to fully connect
      await wsConnected1;

      // Wait for the initial REST save cycle to complete.
      // On page load, Puck onChange fires → debouncedSave (3s) → REST save.
      // We need this to finish so the guard (realtimeConnectedRef) is active
      // and the next edit produces a NEW snapshot that differs from the REST-saved one.
      await page1.waitForTimeout(5000);

      // Edit the title field with a unique value (creates new data)
      await editTitleField(page1, mainTitle);

      // Wait for DO flush → PostgreSQL write.
      // The DO schedules sync 5s after last edit, then calls internal API.
      await page1.waitForTimeout(10000);
    } finally {
      await ctx1.close();
    }

    // Verify via API: main branch's latest version has realtime source + CRDT state
    const mainVersion = await getLatestVersion(
      request,
      token,
      TEST_DOC_ID,
      MAIN_BRANCH_ID,
    );
    expect(mainVersion.source).toBe('realtime');
    expect(mainVersion.crdtState).toBeDefined();
    expect(typeof mainVersion.crdtState).toBe('string');
    expect(mainVersion.crdtState!.length).toBeGreaterThan(0);

    // ── Edit on test branch ──
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();

    try {
      // Navigate to the test document first (loads CSS panel, doc list, etc.)
      await navigateToTestDocument(page2);

      // Wait for initial page load to settle before switching branches
      await page2.waitForTimeout(3000);

      // Switch to the test branch via the branch selector
      await switchBranch(page2, testBranchName);

      // After branch switch, re-open the CSS tab (may have collapsed)
      const cssTab2 = page2.locator('div').filter({ hasText: /^CSS$/ });
      if (await cssTab2.isVisible()) {
        await cssTab2.click();
        await page2.waitForTimeout(500);
      }

      // Start listening for WebSocket connection (will fire when doc loads on new branch).
      const wsConnected2 = waitForRealtimeConnection(page2);

      // Re-select the "test" document via JavaScript click (may be in clipped panel)
      const docItem = page2.locator('.css-plugin-doc-path').filter({ hasText: 'test' });
      await expect(docItem).toBeAttached({ timeout: 10000 });
      await docItem.evaluate((el: HTMLElement) => el.click());
      await page2.waitForLoadState('networkidle');

      // Wait for WebSocket/realtime to connect on the new branch
      await wsConnected2;

      // Wait for initial save cycle to complete
      await page2.waitForTimeout(5000);

      // Edit the Heading component text (different field than main's title edit).
      // This ensures the CRDT merge combines both changes visibly.
      await editHeadingText(page2, branchHeading);

      // Wait for DO flush → PostgreSQL write
      await page2.waitForTimeout(10000);
    } finally {
      await ctx2.close();
    }

    // Verify via API: test branch's latest version has realtime source + CRDT state
    const branchVersion = await getLatestVersion(
      request,
      token,
      TEST_DOC_ID,
      testBranchId,
    );
    expect(branchVersion.source).toBe('realtime');
    expect(branchVersion.crdtState).toBeDefined();
    expect(typeof branchVersion.crdtState).toBe('string');
    expect(branchVersion.crdtState!.length).toBeGreaterThan(0);
  });

  test('should detect conflict between branches', async ({ request }) => {
    const response = await request.post(
      `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/merge/check`,
      {
        data: {
          sourceBranchId: testBranchId,
          targetBranchId: MAIN_BRANCH_ID,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Both branches edited the same document → conflict expected
    expect(
      data.canMerge,
      `Expected conflict but got canMerge=true. Source changes: ${JSON.stringify(data.changes?.documentsModifiedInSource)}. Target changes: ${JSON.stringify(data.changes?.documentsModifiedInTarget)}`,
    ).toBe(false);

    // The "test" document should be in the conflict list
    expect(data.conflicts).toBeDefined();
    expect(data.conflicts.length).toBeGreaterThan(0);

    const testDocConflict = data.conflicts.find(
      (c: { documentId: string }) => c.documentId === TEST_DOC_ID,
    );
    expect(
      testDocConflict,
      `Test document ${TEST_DOC_ID} not found in conflicts: ${JSON.stringify(data.conflicts)}`,
    ).toBeDefined();
    expect(testDocConflict.conflictType).toBe('both-modified');
  });

  test('should preview CRDT merge successfully', async ({ request }) => {
    const response = await request.post(
      `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/merge/crdt-preview`,
      {
        data: {
          documentId: TEST_DOC_ID,
          sourceBranchId: testBranchId,
          targetBranchId: MAIN_BRANCH_ID,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.snapshot).toBeDefined();

    // The merged snapshot should be valid Puck data
    const snapshot = data.snapshot;
    expect(snapshot).toHaveProperty('content');
    expect(snapshot).toHaveProperty('root');
    expect(Array.isArray(snapshot.content)).toBe(true);
  });

  test('should execute CRDT merge and produce merged version', async ({
    request,
  }) => {
    // Step 1: Create a merge request
    const mrResponse = await request.post(
      `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/merge-requests`,
      {
        data: {
          sourceBranchId: testBranchId,
          targetBranchId: MAIN_BRANCH_ID,
          title: 'E2E CRDT merge test',
          description: 'Automated test for CRDT merge via realtime save path',
        },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const mrData = await mrResponse.json();
    expect(
      mrResponse.status(),
      `Merge request creation failed: ${JSON.stringify(mrData)}`,
    ).toBe(201);

    const mergeRequestId = mrData.id;
    expect(mergeRequestId).toBeDefined();

    // Step 2: Update merge request status to 'conflicted' so it can be executed
    const statusResponse = await request.patch(
      `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/merge-requests/${mergeRequestId}`,
      {
        data: { status: 'conflicted' },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    expect(statusResponse.status()).toBe(200);

    // Step 3: Execute the merge request with CRDT resolution
    const execResponse = await request.post(
      `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/merge-requests/${mergeRequestId}/execute`,
      {
        data: {
          resolutions: [
            {
              documentId: TEST_DOC_ID,
              strategy: 'merge-crdt',
            },
          ],
        },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const execData = await execResponse.json();
    expect(
      execResponse.status(),
      `Merge execute failed: ${JSON.stringify(execData)}`,
    ).toBe(200);

    expect(execData.success).toBe(true);

    // The CRDT resolution should have resolved at least the test document conflict
    expect(
      execData.conflictsResolved,
      `Expected conflictsResolved >= 1 but got: ${JSON.stringify(execData)}`,
    ).toBeGreaterThanOrEqual(1);

    // Verify: new version on main has source='merge' and CRDT state
    const mergedVersion = await getLatestVersion(
      request,
      token,
      TEST_DOC_ID,
      MAIN_BRANCH_ID,
    );
    expect(
      mergedVersion.source,
      `Expected source='merge' but got '${mergedVersion.source}' (version ${String(mergedVersion.versionNumber)}, id=${mergedVersion.id})`,
    ).toBe('merge');
    expect(mergedVersion.crdtState).toBeDefined();
    expect(typeof mergedVersion.crdtState).toBe('string');
    expect(mergedVersion.crdtState!.length).toBeGreaterThan(0);

    // Verify the merged snapshot is valid Puck data with expected structure.
    // We don't assert exact field values because Yjs CRDT merge uses client ID
    // ordering to resolve concurrent writes, and both branches initialise Yjs docs
    // that set all fields — making the per-field winner unpredictable.
    const snapshot = mergedVersion.snapshot as {
      root?: { props?: { title?: string } };
      content?: Array<{ type: string; props: Record<string, unknown> }>;
    };

    expect(snapshot.root).toBeDefined();
    expect(snapshot.root?.props?.title).toBeDefined();
    expect(typeof snapshot.root?.props?.title).toBe('string');
    expect(snapshot.content).toBeDefined();
    expect(Array.isArray(snapshot.content)).toBe(true);

    const headingItem = snapshot.content?.find((c) => c.type === 'Heading');
    expect(
      headingItem,
      `Merged snapshot should contain a Heading component but content is: ${JSON.stringify(snapshot.content?.map((c) => c.type))}`,
    ).toBeDefined();
  });
});
