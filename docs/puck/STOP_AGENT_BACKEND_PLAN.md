# Stop Agent Backend Implementation Plan

## Overview

This document outlines the backend changes needed in `collaborative-state-system` to support the "Stop Agent" feature, which allows human users to stop an agent's current edit session and roll back any changes.

## New Endpoint

### `POST /agent-stop`

**Full Path:** `POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-stop`

**Purpose:** Allow humans to stop an agent's current edit session. The server handles looking up the agent's session and performing the rollback.

### Request

```typescript
interface AgentStopRequest {
  agentId: string;  // The agent to stop
}
```

**Headers:**
- `Authorization: Bearer {apiKey}` or `X-API-Key: {apiKey}`
- `Content-Type: application/json`
- `X-Principal-Id: {userId}` (optional, the human requesting the stop)
- `X-Principal-Type: user` (optional)

### Response

```typescript
interface AgentStopResult {
  success: boolean;
  rolledBack: boolean;  // true if changes were reverted
  message?: string;     // e.g., "No active session for agent"
}
```

**Status Codes:**
- `200 OK` - Request processed (check `success` field)
- `400 Bad Request` - Missing `agentId`
- `401 Unauthorized` - Invalid API key
- `404 Not Found` - Site, branch, or document not found
- `500 Internal Server Error` - Server error during rollback

### Examples

**Request:**
```http
POST /api/sites/site-1/branches/main/documents/%2Fhome/agent-stop
Content-Type: application/json
Authorization: Bearer xxx

{
  "agentId": "agent-123"
}
```

**Response (agent had active session):**
```json
{
  "success": true,
  "rolledBack": true
}
```

**Response (agent had no active session):**
```json
{
  "success": true,
  "rolledBack": false,
  "message": "No active session for agent"
}
```

---

## Implementation Details

### 1. DocumentSession Durable Object

**File:** `workers/src/durable-objects/document-session.ts`

#### Add Route Handler

Add to the `fetch` method's route matching:

```typescript
// In handleDocumentRequest or equivalent
if (url.pathname.endsWith('/agent-stop') && request.method === 'POST') {
  return this.handleAgentStop(request);
}
```

#### Add Handler Method

```typescript
private async handleAgentStop(request: Request): Promise<Response> {
  const body = await request.json() as { agentId?: string };

  if (!body.agentId) {
    return new Response(JSON.stringify({ error: 'agentId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const agentId = body.agentId;

  // Look up agent's active session
  const session = this.getAgentSession(agentId);

  if (!session) {
    return new Response(JSON.stringify({
      success: true,
      rolledBack: false,
      message: 'No active session for agent',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Roll back to checkpoint if exists
    if (session.checkpointId) {
      await this.rollbackToCheckpoint(session.checkpointId);
    }

    // Clear agent's session
    this.clearAgentSession(agentId);

    // Clear agent's presence (focusRegions, state)
    await this.presenceManager.updateState(agentId, 'idle');
    await this.presenceManager.updateFocusRegions(agentId, []);

    // Broadcast presence update to all clients
    this.broadcastPresenceUpdate();

    return new Response(JSON.stringify({
      success: true,
      rolledBack: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[agent-stop] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      rolledBack: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

### 2. Agent Session Storage

The DocumentSession needs to track active agent sessions. This may already exist from the `agent-edit-start` implementation.

**Required data structure:**

```typescript
interface ActiveAgentSession {
  agentId: string;
  sessionId: string;
  checkpointId?: string;
  targetRegions: string[];
  startedAt: number;
  trigger: 'autonomous' | 'human_requested';
}

// Map of agentId -> session
private activeAgentSessions: Map<string, ActiveAgentSession> = new Map();
```

**Methods needed:**

```typescript
private getAgentSession(agentId: string): ActiveAgentSession | undefined {
  return this.activeAgentSessions.get(agentId);
}

private clearAgentSession(agentId: string): void {
  this.activeAgentSessions.delete(agentId);
}
```

### 3. Checkpoint Rollback

The rollback logic should already exist from the `agent-edit-abort` endpoint. Reuse that:

```typescript
private async rollbackToCheckpoint(checkpointId: string): Promise<void> {
  // Get checkpoint data
  const checkpoint = await this.getCheckpoint(checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint ${checkpointId} not found`);
  }

  // Apply checkpoint state to Yjs document
  // This should broadcast the state change to all connected clients
  await this.applyCheckpointState(checkpoint);
}
```

### 4. Session Storage on Edit Start

Ensure `handleAgentEditStart` stores the session:

```typescript
// In handleAgentEditStart, after creating checkpoint:
this.activeAgentSessions.set(context.agentId, {
  agentId: context.agentId,
  sessionId: generatedSessionId,
  checkpointId: checkpoint?.id,
  targetRegions: context.targetRegions,
  startedAt: Date.now(),
  trigger: context.trigger,
});
```

### 5. Session Cleanup on Complete/Abort

Ensure existing handlers clear the session:

```typescript
// In handleAgentEditComplete:
this.clearAgentSession(agentId);

// In handleAgentEditAbort:
this.clearAgentSession(agentId);
```

---

## Testing

### Unit Tests

Add to `workers/tests/document-session.spec.ts` or create `workers/tests/agent-stop.spec.ts`:

```typescript
describe('agent-stop endpoint', () => {
  it('should return success with rolledBack=false when agent has no session', async () => {
    const response = await session.handleAgentStop({
      agentId: 'unknown-agent',
    });

    expect(response.success).toBe(true);
    expect(response.rolledBack).toBe(false);
    expect(response.message).toContain('No active session');
  });

  it('should rollback and clear session when agent has active session', async () => {
    // Start an agent session first
    await session.handleAgentEditStart({
      agentId: 'agent-1',
      trigger: 'autonomous',
      intent: 'Testing',
      targetRegions: ['/content/0'],
    });

    // Make some changes
    await session.applyYjsUpdate(mockUpdate);

    // Stop the agent
    const response = await session.handleAgentStop({
      agentId: 'agent-1',
    });

    expect(response.success).toBe(true);
    expect(response.rolledBack).toBe(true);

    // Verify session is cleared
    expect(session.getAgentSession('agent-1')).toBeUndefined();

    // Verify presence is updated
    const presence = await session.getPresence('agent-1');
    expect(presence.state).toBe('idle');
    expect(presence.focusRegions).toEqual([]);
  });

  it('should broadcast presence update after stopping agent', async () => {
    const broadcastSpy = vi.spyOn(session, 'broadcastPresenceUpdate');

    await session.handleAgentEditStart({ agentId: 'agent-1', ... });
    await session.handleAgentStop({ agentId: 'agent-1' });

    expect(broadcastSpy).toHaveBeenCalled();
  });

  it('should return 400 when agentId is missing', async () => {
    const response = await session.handleAgentStop({});

    expect(response.status).toBe(400);
  });
});
```

### E2E Tests

Add to `e2e/agent-stop.spec.ts`:

```typescript
test('human can stop agent and see changes rolled back', async ({ page, request }) => {
  // 1. Human opens document
  await page.goto('/editor?path=/home');

  // 2. Agent starts editing via API
  await request.post('/api/.../agent-edit-start', {
    data: { agentId: 'test-agent', ... },
  });

  // 3. Agent makes a change
  await request.post('/api/.../crdt-update', {
    data: { update: mockAddComponentUpdate },
  });

  // 4. Human clicks Stop Agent button
  await page.click('button:has-text("Stop Agent")');

  // 5. Verify change is rolled back
  await expect(page.locator('[data-component-id="new-component"]')).not.toBeVisible();

  // 6. Verify agent banner disappears
  await expect(page.locator('.css-puck-agent-banner')).not.toBeVisible();
});
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `workers/src/durable-objects/document-session.ts` | Add route, handler, session storage |
| `workers/src/types.ts` | Add `AgentStopRequest`, `AgentStopResult` types (optional) |
| `workers/tests/document-session.spec.ts` | Add unit tests |
| `e2e/agent-stop.spec.ts` | Add E2E tests |

---

## Rollout Checklist

- [ ] Implement `handleAgentStop` handler
- [ ] Add route matching for `/agent-stop`
- [ ] Ensure session storage in `handleAgentEditStart`
- [ ] Ensure session cleanup in `handleAgentEditComplete` and `handleAgentEditAbort`
- [ ] Add unit tests
- [ ] Add E2E tests
- [ ] Deploy to staging
- [ ] Test with frontend demo app
- [ ] Deploy to production

---

## Related Files

**Frontend (puck-css-integration):**
- `packages/css-client/src/endpoints/agent-edit.ts` - `stopAgent()` method
- `packages/css-client/src/types.ts` - `AgentStopResult` type
- `packages/puck-css/src/plugin/createCSSOverrides.tsx` - `onStopAgent` prop
- `apps/demo/src/App.tsx` - `handleStopAgent` callback

**Backend (collaborative-state-system):**
- `workers/src/durable-objects/document-session.ts` - Main implementation
