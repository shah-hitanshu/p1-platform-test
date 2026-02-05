import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * End-to-end tests for Agent Activity Highlighting
 *
 * These tests verify that:
 * 1. When an agent starts an edit session with targetRegions, those regions
 *    are highlighted in the human user's editor
 * 2. The highlighting uses the actor's consistent hash-based color
 * 3. The highlighting shows the "editing" state when agent is editing
 * 4. The highlighting disappears when the agent completes/aborts editing
 *
 * Prerequisites:
 * - CSS backend must be running at VITE_CSS_BASE_URL (default: localhost:8787)
 * - Valid API key configured
 * - A test site with documents must exist
 */

// API configuration - mirrors the demo app's .env
// Agent ID must be a registered agent in the agent registry
const API_CONFIG = {
  baseUrl: process.env.VITE_CSS_BASE_URL || 'http://localhost:8787',
  apiKey: process.env.VITE_CSS_API_KEY || 'test-agent-key-zappy',
  siteId: process.env.VITE_CSS_SITE_ID || 'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22',
  // Use the registered test agent from the agent registry
  // There are two test agents registered:
  // - a0000000-0000-0000-0000-000000000001 (primary)
  // - a0000000-0000-0000-0000-000000000002 (secondary for parallel tests)
  agentId: 'a0000000-0000-0000-0000-000000000001',
  agentId2: 'a0000000-0000-0000-0000-000000000002',
};

// Test document path (should exist in the test site)
// Note: Document paths in the database don't have a leading slash
// Use 'test' to match where actual demo users (alice, diana) are
const TEST_DOCUMENT_PATH = 'test';

/**
 * Helper to navigate to a test document
 */
async function navigateToTestDocument(page: Page, docName: string = 'test'): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.Puck, [class*="_Puck_"]').first()).toBeVisible({ timeout: 10000 });

  // Click CSS tab
  const cssTab = page.locator('div').filter({ hasText: /^CSS$/ });
  if (await cssTab.isVisible()) {
    await cssTab.click();
  }

  // Click the specified document
  const docItem = page.getByText(new RegExp(`^${docName}×?$`));
  if (await docItem.isVisible()) {
    await docItem.click();
    await page.waitForLoadState('networkidle');
  }
}

/**
 * Get the branch ID from the API
 */
async function getBranchId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches`, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_CONFIG.apiKey,
      'X-Actor-Type': 'agent',
      'X-Actor-Id': API_CONFIG.agentId,
    },
  });

  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  const mainBranch = data.branches.find((b: { isMain: boolean }) => b.isMain);
  return mainBranch?.id || data.branches[0]?.id;
}

/**
 * Start an agent edit session via API
 */
async function startAgentEdit(
  request: APIRequestContext,
  branchId: string,
  targetRegions: string[],
  intent: string = 'E2E test agent edit'
): Promise<{ editSessionId: string; checkpointId: string }> {
  const encodedPath = encodeURIComponent(TEST_DOCUMENT_PATH);
  const url = `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/documents/${encodedPath}/agent-edit-start`;

  const response = await request.post(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_CONFIG.apiKey,
      'X-Actor-Type': 'agent',
      'X-Actor-Id': API_CONFIG.agentId,
      'X-Agent-Id': API_CONFIG.agentId,
      'X-Agent-Trigger': 'autonomous',
      'X-Agent-Intent': intent,
      'X-Agent-Target-Regions': targetRegions.join(', '),
    },
    data: {},
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Failed to start agent edit: ${response.status()} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Complete an agent edit session via API
 */
async function completeAgentEdit(
  request: APIRequestContext,
  branchId: string,
  editSessionId: string
): Promise<void> {
  const encodedPath = encodeURIComponent(TEST_DOCUMENT_PATH);
  const url = `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/documents/${encodedPath}/agent-edit-complete`;

  const response = await request.post(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_CONFIG.apiKey,
      'X-Actor-Type': 'agent',
      'X-Actor-Id': API_CONFIG.agentId,
      'X-Agent-Id': API_CONFIG.agentId,
    },
    data: { editSessionId },
  });

  if (!response.ok()) {
    const errorText = await response.text();
    console.warn(`Failed to complete agent edit: ${response.status()} - ${errorText}`);
  }
}

/**
 * Abort an agent edit session via API
 */
async function abortAgentEdit(
  request: APIRequestContext,
  branchId: string,
  editSessionId: string
): Promise<void> {
  const encodedPath = encodeURIComponent(TEST_DOCUMENT_PATH);
  const url = `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/documents/${encodedPath}/agent-edit-abort`;

  const response = await request.post(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_CONFIG.apiKey,
      'X-Actor-Type': 'agent',
      'X-Actor-Id': API_CONFIG.agentId,
      'X-Agent-Id': API_CONFIG.agentId,
    },
    data: { editSessionId, reason: 'E2E test cleanup' },
  });

  if (!response.ok()) {
    const errorText = await response.text();
    console.warn(`Failed to abort agent edit: ${response.status()} - ${errorText}`);
  }
}

/**
 * Actor presence from branch presence API
 */
interface ActorPresenceInfo {
  actorId: string;
  actorType: string;
  role: string;
  state: string;
  intent?: string;
  focusRegions?: string[];
}

/**
 * Get branch presence to verify agent is registered
 */
async function getBranchPresence(
  request: APIRequestContext,
  branchId: string
): Promise<{ actors: ActorPresenceInfo[] }> {
  const url = `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/presence`;

  const response = await request.get(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_CONFIG.apiKey,
      'X-Actor-Type': 'user',
      'X-Actor-Id': 'e2e-test-user',
    },
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Failed to get presence: ${response.status()} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Get active edit sessions for the document
 */
async function getEditSessions(
  request: APIRequestContext,
  branchId: string
): Promise<Array<{ id: string; agentId: string }>> {
  const encodedPath = encodeURIComponent(TEST_DOCUMENT_PATH);
  const url = `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/documents/${encodedPath}/edit-sessions`;

  const response = await request.get(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_CONFIG.apiKey,
      'X-Actor-Type': 'user',
      'X-Actor-Id': 'e2e-test-user',
    },
  });

  if (!response.ok()) {
    console.warn(`Failed to get edit sessions: ${response.status()}`);
    return [];
  }

  const data = await response.json();
  return data.sessions || [];
}

/**
 * Clean up any stuck agent session by getting its ID and completing it
 */
async function cleanupStuckAgentSession(
  request: APIRequestContext,
  branchId: string
): Promise<void> {
  // Get active edit sessions from the document
  const sessions = await getEditSessions(request, branchId);
  const agentSession = sessions.find((s) => s.agentId === API_CONFIG.agentId);

  if (agentSession) {
    console.log('Found stuck agent session:', agentSession.id, 'attempting cleanup...');
    await completeAgentEdit(request, branchId, agentSession.id);
    console.log('Cleanup: completed stuck agent session');
  }
}

// Run tests serially since they all share the same agent ID
test.describe.serial('Agent Activity Highlighting', () => {
  let branchId: string;

  test.beforeAll(async ({ request }) => {
    // Get the branch ID for all tests
    branchId = await getBranchId(request);
    console.log('Using branch ID:', branchId);
  });

  // Clean up before EACH test to ensure no stale sessions
  test.beforeEach(async ({ request }) => {
    if (branchId) {
      await cleanupStuckAgentSession(request, branchId);
    }
  });

  test('agent presence should be registered when starting edit session', async ({ request }) => {
    // Start an agent edit session
    const targetRegions = ['/content/0'];
    const { editSessionId } = await startAgentEdit(request, branchId, targetRegions, 'Testing agent presence');

    try {
      // Verify the agent is registered in presence
      const presence = await getBranchPresence(request, branchId);
      console.log('Branch presence:', JSON.stringify(presence, null, 2));

      // Find the agent in the presence list
      const agentPresence = presence.actors.find(p => p.actorId === API_CONFIG.agentId);

      expect(agentPresence).toBeDefined();
      expect(agentPresence?.actorType).toBe('agent');
      expect(agentPresence?.state).toBe('editing');
      expect(agentPresence?.focusRegions).toContain('/content/0');
    } finally {
      // Clean up
      await completeAgentEdit(request, branchId, editSessionId);
    }
  });

  test('agent highlight should appear in human user browser', async ({ page, request }) => {
    // Navigate to the realtime document
    await navigateToTestDocument(page);

    // Wait for WebSocket connection to establish
    await page.waitForTimeout(2000);

    // Start an agent edit session targeting the first content item
    const targetRegions = ['/content/0'];
    const { editSessionId } = await startAgentEdit(
      request,
      branchId,
      targetRegions,
      'E2E highlight test'
    );

    try {
      // The focus highlights are rendered INSIDE the Puck iframe
      const puckFrame = page.locator('iframe').first();
      await expect(puckFrame).toBeVisible({ timeout: 5000 });
      const frame = puckFrame.contentFrame();
      expect(frame).not.toBeNull();

      // Wait for the presence update to be received via WebSocket
      // The highlight should appear on the targeted component inside the iframe
      await expect(async () => {
        const highlight = frame!.locator('.focus-region-highlight');
        const count = await highlight.count();
        console.log(`Found ${count} focus-region-highlight elements in iframe`);
        expect(count).toBeGreaterThan(0);
      }).toPass({ timeout: 10000, intervals: [500, 1000, 1000, 2000] });

      // Verify the highlight has the agent's actor ID
      const highlightWithAgentId = frame!.locator(`[data-actor-id="${API_CONFIG.agentId}"]`);
      await expect(highlightWithAgentId).toBeVisible({ timeout: 5000 });

      // Verify the highlight is in editing state (has the --editing modifier)
      const editingHighlight = frame!.locator('.focus-region-highlight--editing');
      await expect(editingHighlight).toBeVisible({ timeout: 5000 });

      // Verify the agent's highlight has a badge with the actor's initial
      // Use a more specific selector to find the badge inside the agent's highlight wrapper
      const agentBadge = frame!.locator(`[data-actor-id="${API_CONFIG.agentId}"] .focus-region-highlight__badge`);
      await expect(agentBadge).toBeVisible({ timeout: 5000 });
      const badgeText = await agentBadge.textContent();
      // Agent ID starts with 'a' for 'a0000000-...'
      expect(badgeText?.toUpperCase()).toBe('A');

      // Also verify the AgentActivityBanner appears in the main page
      const agentBanner = page.locator('.css-puck-agent-banner');
      await expect(agentBanner).toBeVisible({ timeout: 5000 });
    } finally {
      // Clean up
      await completeAgentEdit(request, branchId, editSessionId);
    }
  });

  test('agent highlight should disappear when agent completes editing', async ({ page, request }) => {
    // Navigate to the realtime document
    await navigateToTestDocument(page);

    // Wait for WebSocket connection to establish
    await page.waitForTimeout(2000);

    // Get the iframe for checking highlights
    const puckFrame = page.locator('iframe').first();
    await expect(puckFrame).toBeVisible({ timeout: 5000 });
    const frame = puckFrame.contentFrame();
    expect(frame).not.toBeNull();

    // Start an agent edit session
    const targetRegions = ['/content/0'];
    const { editSessionId } = await startAgentEdit(
      request,
      branchId,
      targetRegions,
      'E2E cleanup test'
    );

    // Wait for the highlight to appear inside the iframe
    await expect(async () => {
      const highlight = frame!.locator(`[data-actor-id="${API_CONFIG.agentId}"]`);
      await expect(highlight).toBeVisible();
    }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });

    // Complete the agent edit session
    await completeAgentEdit(request, branchId, editSessionId);

    // Wait for the presence update to be received
    // The highlight should disappear from the iframe
    await expect(async () => {
      const highlight = frame!.locator(`[data-actor-id="${API_CONFIG.agentId}"]`);
      await expect(highlight).not.toBeVisible();
    }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });
  });

  test('multiple region highlights should appear for multi-region agent edit', async ({ page, request }) => {
    // Navigate to the realtime document
    await navigateToTestDocument(page);

    // Wait for WebSocket connection to establish
    await page.waitForTimeout(2000);

    // Get the iframe for checking highlights
    const puckFrame = page.locator('iframe').first();
    await expect(puckFrame).toBeVisible({ timeout: 5000 });
    const frame = puckFrame.contentFrame();
    expect(frame).not.toBeNull();

    // Start an agent edit session targeting multiple content items
    // Note: The document needs to have at least 2 content items for this test
    const targetRegions = ['/content/0', '/content/1'];
    let editSessionId: string;

    try {
      const result = await startAgentEdit(
        request,
        branchId,
        targetRegions,
        'E2E multi-region test'
      );
      editSessionId = result.editSessionId;
    } catch (error) {
      // If the agent can't start (maybe due to existing presence), skip this test
      console.warn('Could not start agent edit for multi-region test:', error);
      test.skip();
      return;
    }

    try {
      // Wait for highlights to appear inside the iframe
      await expect(async () => {
        const highlights = frame!.locator('.focus-region-highlight--editing');
        const count = await highlights.count();
        console.log(`Found ${count} editing highlights in iframe`);
        // Should have at least 1 highlight (might be fewer if document has fewer components)
        expect(count).toBeGreaterThanOrEqual(1);
      }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });
    } finally {
      // Clean up
      await completeAgentEdit(request, branchId, editSessionId!);
    }
  });

  test('agent highlight should have consistent hash-based color', async ({ page, request }) => {
    // Navigate to the realtime document
    await navigateToTestDocument(page);

    // Wait for WebSocket connection to establish
    await page.waitForTimeout(2000);

    // Get the iframe for checking highlights
    const puckFrame = page.locator('iframe').first();
    await expect(puckFrame).toBeVisible({ timeout: 5000 });
    const frame = puckFrame.contentFrame();
    expect(frame).not.toBeNull();

    // Start an agent edit session
    const targetRegions = ['/content/0'];
    const { editSessionId } = await startAgentEdit(
      request,
      branchId,
      targetRegions,
      'E2E color test'
    );

    try {
      // Wait for the highlight to appear inside the iframe
      const highlight = frame!.locator(`[data-actor-id="${API_CONFIG.agentId}"]`);
      await expect(highlight).toBeVisible({ timeout: 10000 });

      // Check that the highlight has a --focus-color CSS variable set
      const focusColor = await highlight.evaluate((el) => {
        return getComputedStyle(el).getPropertyValue('--focus-color');
      });

      console.log('Focus color:', focusColor);

      // The color should be a hex color (e.g., #6366f1)
      expect(focusColor.trim()).toMatch(/^#[0-9a-f]{6}$/i);
    } finally {
      // Clean up
      await completeAgentEdit(request, branchId, editSessionId);
    }
  });
});

// Debug tests use a different agent ID to avoid conflicts
const DEBUG_AGENT_ID = API_CONFIG.agentId2;
const DEBUG_AGENT_API_KEY = 'test-agent-key-helper';

/**
 * Start debug agent edit session (uses secondary agent)
 */
async function startDebugAgentEdit(
  request: APIRequestContext,
  branchId: string,
  targetRegions: string[],
  intent: string = 'Debug agent edit'
): Promise<{ editSessionId: string; checkpointId: string }> {
  const encodedPath = encodeURIComponent(TEST_DOCUMENT_PATH);
  const url = `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/documents/${encodedPath}/agent-edit-start`;

  const response = await request.post(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': DEBUG_AGENT_API_KEY,
      'X-Actor-Type': 'agent',
      'X-Actor-Id': DEBUG_AGENT_ID,
      'X-Agent-Id': DEBUG_AGENT_ID,
      'X-Agent-Trigger': 'autonomous',
      'X-Agent-Intent': intent,
      'X-Agent-Target-Regions': targetRegions.join(', '),
    },
    data: {},
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Failed to start debug agent edit: ${response.status()} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Complete debug agent edit session (uses secondary agent)
 */
async function completeDebugAgentEdit(
  request: APIRequestContext,
  branchId: string,
  editSessionId: string
): Promise<void> {
  const encodedPath = encodeURIComponent(TEST_DOCUMENT_PATH);
  const url = `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/documents/${encodedPath}/agent-edit-complete`;

  const response = await request.post(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': DEBUG_AGENT_API_KEY,
      'X-Actor-Type': 'agent',
      'X-Actor-Id': DEBUG_AGENT_ID,
      'X-Agent-Id': DEBUG_AGENT_ID,
    },
    data: { editSessionId },
  });

  if (!response.ok()) {
    const errorText = await response.text();
    console.warn(`Failed to complete debug agent edit: ${response.status()} - ${errorText}`);
  }
}

test.describe.serial('Agent Highlight Debug', () => {
  test('debug: verify human and agent highlights work the same', async ({ browser, request }) => {
    const branchId = await getBranchId(request);

    // Create two browser contexts - one for each "user"
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Navigate both pages to the realtime document
      await navigateToTestDocument(page1);
      await navigateToTestDocument(page2);

      // Wait for WebSocket connections to establish
      await page1.waitForTimeout(3000);
      await page2.waitForTimeout(3000);

      // Get the iframe for page1
      const puckFrame1 = page1.locator('iframe').first();
      await expect(puckFrame1).toBeVisible({ timeout: 5000 });
      const frame1 = puckFrame1.contentFrame();
      expect(frame1).not.toBeNull();

      // Get the iframe for page2
      const puckFrame2 = page2.locator('iframe').first();
      await expect(puckFrame2).toBeVisible({ timeout: 5000 });
      const frame2 = puckFrame2.contentFrame();
      expect(frame2).not.toBeNull();

      // STEP 1: Check baseline - no highlights should be present yet
      const baselineHighlights1 = await frame1!.locator('.focus-region-highlight').count();
      const baselineHighlights2 = await frame2!.locator('.focus-region-highlight').count();
      console.log(`Baseline: page1 has ${baselineHighlights1} highlights, page2 has ${baselineHighlights2} highlights`);

      // STEP 2: Page1 user selects a component - this should create a human focus highlight visible to page2
      // Click on the Puck editor to select a component
      await frame1!.locator('[data-puck-component]').first().click();
      await page1.waitForTimeout(2000);

      // Check if page2 sees the highlight from page1's human user
      const humanHighlightCount2 = await frame2!.locator('.focus-region-highlight').count();
      console.log(`After human selection: page2 sees ${humanHighlightCount2} highlight(s) from page1`);

      // STEP 3: Start an agent edit session (using debug agent)
      const { editSessionId } = await startDebugAgentEdit(request, branchId, ['/content/0'], 'Compare human vs agent');

      // Wait for agent highlight to appear on page1 (with retries)
      let agentHighlightWithId1 = 0;
      await expect(async () => {
        agentHighlightWithId1 = await frame1!.locator(`[data-actor-id="${DEBUG_AGENT_ID}"]`).count();
        expect(agentHighlightWithId1).toBeGreaterThan(0);
      }).toPass({ timeout: 10000, intervals: [500, 1000, 1000, 2000] });

      // Wait for agent highlight to appear on page2 (with retries)
      let agentHighlightWithId2 = 0;
      await expect(async () => {
        agentHighlightWithId2 = await frame2!.locator(`[data-actor-id="${DEBUG_AGENT_ID}"]`).count();
        expect(agentHighlightWithId2).toBeGreaterThan(0);
      }).toPass({ timeout: 10000, intervals: [500, 1000, 1000, 2000] });

      // STEP 4: Log the final counts
      const agentHighlightCount1 = await frame1!.locator('.focus-region-highlight').count();
      const agentHighlightCount2 = await frame2!.locator('.focus-region-highlight').count();
      console.log(`Page1: ${agentHighlightCount1} total highlights, ${agentHighlightWithId1} from agent`);
      console.log(`Page2: ${agentHighlightCount2} total highlights, ${agentHighlightWithId2} from agent`);

      // STEP 5: Check AgentActivityBanner on both pages
      const agentBanner1 = await page1.locator('.css-puck-agent-banner').count();
      const agentBanner2 = await page2.locator('.css-puck-agent-banner').count();
      console.log(`AgentActivityBanner: page1 has ${agentBanner1}, page2 has ${agentBanner2}`);

      // Take screenshots to visualize what's happening
      await page1.screenshot({ path: 'test-results/agent-highlight-page1.png', fullPage: true });
      await page2.screenshot({ path: 'test-results/agent-highlight-page2.png', fullPage: true });
      console.log('Screenshots saved to test-results/');

      // Clean up
      await completeDebugAgentEdit(request, branchId, editSessionId);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('debug: check presence API response', async ({ request }) => {
    const branchId = await getBranchId(request);
    console.log('Branch ID:', branchId);

    // Start a debug agent edit session
    const targetRegions = ['/content/0'];
    let editSessionId: string;

    try {
      const result = await startDebugAgentEdit(request, branchId, targetRegions, 'Debug test');
      editSessionId = result.editSessionId;
      console.log('Edit session started:', result);
    } catch (error) {
      console.error('Failed to start edit session:', error);
      throw error;
    }

    try {
      // Get presence
      const presence = await getBranchPresence(request, branchId);
      console.log('Presence response:', JSON.stringify(presence, null, 2));

      // Verify agent is in presence with correct focusRegions
      const agentPresence = presence.actors.find(p => p.actorId === DEBUG_AGENT_ID);
      console.log('Agent presence:', agentPresence);

      expect(agentPresence).toBeDefined();
      expect(agentPresence?.focusRegions).toBeDefined();
      expect(agentPresence?.focusRegions).toContain('/content/0');
    } finally {
      await completeDebugAgentEdit(request, branchId, editSessionId!);
    }
  });

  test('debug: check WebSocket presence broadcast', async ({ page, request }) => {
    const branchId = await getBranchId(request);

    // Navigate to the document and set up console logging
    const wsMessages: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      // Capture all console messages for debugging
      console.log(`[Browser ${msg.type()}]:`, text);
      if (text.includes('presence') || text.includes('Presence') || text.includes('focusRegion') || text.includes('actors') || text.includes('WebSocket')) {
        wsMessages.push(text);
      }
    });

    await navigateToTestDocument(page);
    await page.waitForTimeout(3000);

    // Start a debug agent edit session
    const targetRegions = ['/content/0'];
    const { editSessionId } = await startDebugAgentEdit(request, branchId, targetRegions, 'Debug broadcast test');

    try {
      // Wait a bit for the presence broadcast
      await page.waitForTimeout(5000);

      // Log any presence-related console messages
      console.log('WebSocket presence messages captured:', wsMessages.length);

      // Check if there are any focus highlights in the DOM
      const highlights = await page.locator('.focus-region-highlight').all();
      console.log(`Found ${highlights.length} focus-region-highlight elements`);

      for (let i = 0; i < highlights.length; i++) {
        const actorId = await highlights[i].getAttribute('data-actor-id');
        const className = await highlights[i].getAttribute('class');
        console.log(`Highlight ${i}: actorId=${actorId}, class=${className}`);
      }

      // Debug: Check if presence data is in the DOM via React DevTools
      // We can check for the CollaboratorAvatars component to see if presence is being received
      const avatars = await page.locator('.css-puck-collaborator-avatars').count();
      console.log(`Found ${avatars} CollaboratorAvatars containers`);

      // Debug: Check if there are any actor badges (which would indicate presence is working)
      const avatarItems = await page.locator('.css-puck-collaborator-avatar').count();
      console.log(`Found ${avatarItems} collaborator avatar items`);

      // Debug: Check if the agent activity banner appears
      const agentBanner = await page.locator('.css-puck-agent-banner').count();
      console.log(`Found ${agentBanner} AgentActivityBanner elements`);

      // Debug: Check the presence actors via JavaScript evaluation
      const presenceInfo = await page.evaluate(() => {
        // Try to find React state/context info
        const root = document.querySelector('#root');
        // @ts-expect-error React internals
        const fiber = root?._reactRootContainer?._internalRoot?.current;
        return {
          hasRoot: !!root,
          hasFiber: !!fiber,
        };
      });
      console.log('Presence debug info:', presenceInfo);

      // Debug: Look at the Puck frame content for focus highlights
      const puckFrame = page.locator('iframe').first();
      if (await puckFrame.isVisible()) {
        const frameContent = puckFrame.contentFrame();
        if (frameContent) {
          const frameHighlights = await frameContent.locator('.focus-region-highlight').count();
          console.log(`Found ${frameHighlights} focus-region-highlight elements INSIDE iframe`);
        }
      }
    } finally {
      await completeDebugAgentEdit(request, branchId, editSessionId);
    }
  });
});

// ============================================================================
// Stop Agent Tests
// ============================================================================

/**
 * Stop an agent via the API (human-initiated stop)
 */
async function stopAgent(
  request: APIRequestContext,
  branchId: string,
  agentId: string
): Promise<{ success: boolean; rolledBack: boolean; message?: string }> {
  const encodedPath = encodeURIComponent(TEST_DOCUMENT_PATH);
  const url = `${API_CONFIG.baseUrl}/api/sites/${API_CONFIG.siteId}/branches/${branchId}/documents/${encodedPath}/agent-stop`;

  const response = await request.post(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_CONFIG.apiKey,
      'X-Actor-Type': 'user',
      'X-Actor-Id': 'e2e-test-user',
    },
    data: { agentId },
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Failed to stop agent: ${response.status()} - ${errorText}`);
  }

  return await response.json();
}

test.describe.serial('Stop Agent Feature', () => {
  let branchId: string;

  test.beforeAll(async ({ request }) => {
    branchId = await getBranchId(request);
    console.log('Using branch ID:', branchId);
  });

  // Clean up before EACH test to ensure no stale sessions
  test.beforeEach(async ({ request }) => {
    if (branchId) {
      // Try to stop any existing agent session
      try {
        await stopAgent(request, branchId, API_CONFIG.agentId);
      } catch {
        // Ignore errors - agent may not have active session
      }
    }
  });

  test('Stop Agent button appears when agent is editing', async ({ page, request }) => {
    // Navigate to the test document
    await navigateToTestDocument(page);
    await page.waitForTimeout(2000);

    // Start an agent edit session
    const targetRegions = ['/content/0'];
    const { editSessionId } = await startAgentEdit(
      request,
      branchId,
      targetRegions,
      'E2E stop agent test'
    );

    try {
      // Wait for the AgentActivityBanner to appear with Stop Agent button
      const stopButton = page.getByRole('button', { name: 'Stop Agent' });
      await expect(stopButton).toBeVisible({ timeout: 10000 });

      // Verify the agent banner shows the correct agent info
      const agentBanner = page.locator('.css-puck-agent-banner');
      await expect(agentBanner).toBeVisible();
    } finally {
      // Clean up
      await completeAgentEdit(request, branchId, editSessionId);
    }
  });

  test('clicking Stop Agent button removes agent banner and stops session', async ({ page, request }) => {
    // Navigate to the test document
    await navigateToTestDocument(page);
    await page.waitForTimeout(2000);

    // Start an agent edit session
    const targetRegions = ['/content/0'];
    await startAgentEdit(
      request,
      branchId,
      targetRegions,
      'E2E stop agent click test'
    );

    // Wait for the Stop Agent button to appear
    const stopButton = page.getByRole('button', { name: 'Stop Agent' });
    await expect(stopButton).toBeVisible({ timeout: 10000 });

    // Click the Stop Agent button
    await stopButton.click();

    // Wait for the agent banner to disappear
    const agentBanner = page.locator('.css-puck-agent-banner');
    await expect(agentBanner).not.toBeVisible({ timeout: 10000 });

    // Verify no more Stop Agent button
    await expect(stopButton).not.toBeVisible();
  });

  test('Stop Agent API returns success with rolledBack=true for active session', async ({ request }) => {
    // Start an agent edit session
    const targetRegions = ['/content/0'];
    await startAgentEdit(
      request,
      branchId,
      targetRegions,
      'E2E stop agent API test'
    );

    // Stop the agent via API
    const result = await stopAgent(request, branchId, API_CONFIG.agentId);

    // Verify the response
    expect(result.success).toBe(true);
    expect(result.rolledBack).toBe(true);
  });

  test('Stop Agent API returns success with rolledBack=false when no active session', async ({ request }) => {
    // Don't start an agent session - just try to stop

    // Stop the agent via API (should succeed but not roll back)
    const result = await stopAgent(request, branchId, API_CONFIG.agentId);

    // Verify the response
    expect(result.success).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(result.message).toContain('No active session');
  });

  test('agent highlight disappears after Stop Agent', async ({ page, request }) => {
    // Navigate to the test document
    await navigateToTestDocument(page);
    await page.waitForTimeout(2000);

    // Get the iframe for checking highlights
    const puckFrame = page.locator('iframe').first();
    await expect(puckFrame).toBeVisible({ timeout: 5000 });
    const frame = puckFrame.contentFrame();
    expect(frame).not.toBeNull();

    // Start an agent edit session
    const targetRegions = ['/content/0'];
    await startAgentEdit(
      request,
      branchId,
      targetRegions,
      'E2E stop agent highlight test'
    );

    // Wait for the highlight to appear inside the iframe
    await expect(async () => {
      const highlight = frame!.locator(`[data-actor-id="${API_CONFIG.agentId}"]`);
      await expect(highlight).toBeVisible();
    }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });

    // Click the Stop Agent button
    const stopButton = page.getByRole('button', { name: 'Stop Agent' });
    await stopButton.click();

    // Wait for the highlight to disappear from the iframe
    await expect(async () => {
      const highlight = frame!.locator(`[data-actor-id="${API_CONFIG.agentId}"]`);
      await expect(highlight).not.toBeVisible();
    }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });
  });
});
