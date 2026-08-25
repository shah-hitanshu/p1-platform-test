# Agent Integration Guide

This guide explains how to integrate AI agents with the Collaborative Content Repository (CCR). Agents can collaborate with human users on documents, following the "Agent Politeness" system that ensures respectful collaboration.

## Table of Contents

1. [Overview](#overview)
2. [Agent Registration](#agent-registration)
3. [Authentication](#authentication)
4. [Agent Context Headers](#agent-context-headers)
5. [Edit Workflow](#edit-workflow)
6. [Status Management](#status-management)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)

---

## Overview

The Agent Politeness System enables AI agents to:

- **Collaborate respectfully** with human users on documents
- **Wait for appropriate moments** before making autonomous changes
- **Communicate their intent** to other collaborators
- **Provide clear audit trails** for all operations

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Registered Agent** | An agent account registered at the organization level |
| **Agent Status** | Current state: `active`, `suspended`, or `disabled` |
| **Trigger Type** | How an edit was initiated: `human_requested` or `autonomous` |
| **Target Regions** | JSON paths the agent intends to modify |
| **Edit Session** | A reserved period for making changes |

---

## Agent Registration

Agents must be registered with an organization before they can interact with documents.

### Create an Agent

```http
POST /api/organizations/{orgId}/agents
Content-Type: application/json

{
  "name": "Content Assistant",
  "description": "AI assistant for content editing",
  "capabilities": ["content_edit", "content_suggest"],
  "settings": {
    "priorityTier": "standard",
    "maxConcurrentSessions": 5
  }
}
```

**Response:**

```json
{
  "id": "agent-uuid-here",
  "organizationId": "org-uuid-here",
  "name": "Content Assistant",
  "description": "AI assistant for content editing",
  "capabilities": ["content_edit", "content_suggest"],
  "status": "active",
  "settings": {
    "priorityTier": "standard",
    "maxConcurrentSessions": 5
  },
  "createdAt": "2026-01-26T12:00:00Z",
  "updatedAt": "2026-01-26T12:00:00Z"
}
```

### Agent Capabilities

| Capability | Description |
|------------|-------------|
| `content_edit` | Can modify document content |
| `content_suggest` | Can make non-destructive suggestions |
| `structure_edit` | Can modify document structure |
| `metadata_edit` | Can modify document metadata |

### Agent Status Values

| Status | Description | Can Start Edits | Can Complete Edits |
|--------|-------------|-----------------|-------------------|
| `active` | Normal operating state | Yes | Yes |
| `suspended` | Temporarily paused | No | Yes (existing sessions) |
| `disabled` | Fully deactivated | No | No |

---

## Authentication

Agents authenticate using API keys associated with their registration.

### Request Headers

```http
Authorization: Bearer {api-key}
X-Actor-Type: agent
X-Actor-Id: {agent-id}
```

### WebSocket Connection

For real-time collaboration:

```
wss://api.example.com/api/sites/{siteId}/branches/{branchId}/documents/{path}/connect?actorId={agentId}&actorType=agent&apiKey={key}
```

---

## Agent Context Headers

When making requests, agents should provide context via HTTP headers. These headers are processed at the Worker level before reaching the Durable Object.

### Available Headers

| Header | Required | Description | Example |
|--------|----------|-------------|---------|
| `X-Agent-Id` | Yes* | Agent's UUID | `agent-123-uuid` |
| `X-Agent-Trigger` | Yes* | How the edit was initiated | `human_requested` or `autonomous` |
| `X-Agent-Requested-By` | Conditional | User who requested the action (when trigger is `human_requested`) | `user-456-uuid` |
| `X-Agent-Intent` | Yes* | Description of what the agent is doing | `Updating page title` |
| `X-Agent-Operation-Type` | No | Category of operation | `content_update` |
| `X-Agent-Target-Regions` | Yes* | Comma-separated JSON paths | `/content/title, /content/body` |

*Required for `can-agent-edit` and `agent-edit-start` endpoints. Optional for `agent-edit-complete` and `agent-edit-abort`.

### Example Request with Headers

```http
POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/can-agent-edit
Content-Type: application/json
X-Agent-Id: agent-123-uuid
X-Agent-Trigger: human_requested
X-Agent-Requested-By: user-456-uuid
X-Agent-Intent: Updating page title per user request
X-Agent-Target-Regions: /content/title

{}
```

### Header vs Body Parameters

Context can be provided via headers OR request body. When both are present, **body parameters take precedence**.

```http
POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/can-agent-edit
Content-Type: application/json
X-Agent-Id: header-agent-id
X-Agent-Trigger: autonomous

{
  "agentId": "body-agent-id",  // This takes precedence
  "trigger": "human_requested",  // This takes precedence
  "intent": "Update content",
  "targetRegions": ["/content"]
}
```

---

## Edit Workflow

The agent edit workflow ensures polite collaboration by checking permissions before making changes.

### Workflow Steps

```
1. can-agent-edit     Check if editing is allowed
        |
        v
2. agent-edit-start   Reserve the edit session
        |
        v
3. [Make changes]     Apply edits via WebSocket or REST
        |
        v
4. agent-edit-complete   OR   agent-edit-abort
   (commit changes)           (discard changes)
```

### Step 1: Check Edit Permission

Before starting an edit, check if the agent can proceed:

```http
POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/can-agent-edit
Content-Type: application/json
X-Agent-Id: {agentId}
X-Agent-Trigger: autonomous
X-Agent-Intent: Reorganizing content sections
X-Agent-Target-Regions: /content/sections

{}
```

**Success Response (200):**

```json
{
  "canEdit": true,
  "editSessionId": null
}
```

**Denied Response (200):**

```json
{
  "canEdit": false,
  "reason": "active_human_collaborator",
  "message": "A human user is currently editing the document",
  "conflictingRegions": ["/content/sections/0"]
}
```

### Step 2: Start Edit Session

If permission is granted, start the edit session:

```http
POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/agent-edit-start
Content-Type: application/json
X-Agent-Id: {agentId}
X-Agent-Trigger: autonomous
X-Agent-Intent: Reorganizing content sections
X-Agent-Target-Regions: /content/sections

{}
```

**Response (200):**

```json
{
  "editSessionId": "session-uuid-here",
  "expiresAt": "2026-01-26T12:05:00Z",
  "reservedRegions": ["/content/sections"],
  "checkpointId": "checkpoint-uuid-here"
}
```

**Checkpoint Creation:** For autonomous edits, the system automatically creates a pre-edit checkpoint (`agent_pre_edit` type) when the edit session starts. This checkpoint:
- Captures the document state before any agent changes
- Enables rollback if the agent aborts the edit session
- Provides an audit trail of agent activity

For `human_requested` edits, checkpoint creation depends on the requesting user's workflow.

### Step 3: Make Changes

Use the standard edit mechanisms (WebSocket or REST) to make changes. **Important:** When calling the `/apply` endpoint, you MUST include the `editSessionId` from the start response.

```http
POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/apply
Content-Type: application/json
X-Actor-Type: agent
X-Actor-Id: {agentId}

{
  "actorId": "{agentId}",
  "editSessionId": "session-uuid-here",
  "operations": [
    { "op": "replace", "path": "/content/title", "value": "New Title" }
  ]
}
```

**Session Enforcement:** The backend enforces that agents provide a valid `editSessionId` when calling `/apply`. Requests without a valid session will receive a 400 or 403 error:

| Error | Code | Reason |
|-------|------|--------|
| Missing editSessionId | 400 | `editSessionId is required for agents` |
| Invalid session | 403 | `Invalid or expired edit session` |
| Wrong agent | 403 | `Edit session belongs to a different agent` |

This enforcement ensures agents always operate within an edit session, which enables proper checkpoint creation and rollback capability.

### Step 4a: Complete Edit Session

When finished successfully:

```http
POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/agent-edit-complete
Content-Type: application/json
X-Agent-Id: {agentId}

{
  "editSessionId": "session-uuid-here"
}
```

**Response (200):**

```json
{
  "success": true,
  "checkpointId": "checkpoint-uuid-here",
  "postCheckpointId": "post-checkpoint-uuid-here"
}
```

**Post-Edit Checkpoint:** When an agent completes an edit session that had a pre-edit checkpoint, the system automatically creates a post-edit checkpoint (`agent_post_edit` type). This:
- Captures the document state after all agent changes
- Links to the pre-edit checkpoint for audit purposes
- Enables comparison of "before" and "after" states

### Step 4b: Abort Edit Session

If the edit needs to be cancelled:

```http
POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/agent-edit-abort
Content-Type: application/json
X-Agent-Id: {agentId}

{
  "editSessionId": "session-uuid-here",
  "reason": "User cancelled the operation"
}
```

**Response (200):**

```json
{
  "success": true,
  "rolledBack": true,
  "checkpointId": "checkpoint-uuid-here"
}
```

**Automatic Rollback:** When an agent aborts an edit session that had a pre-edit checkpoint, the system automatically reverts all documents to the checkpoint state. The `rolledBack` field indicates whether the rollback was successful:
- `true`: All changes were reverted to the pre-edit checkpoint state
- `false`: No checkpoint was available to rollback to (e.g., for human_requested edits without pre-edit checkpoint)

This ensures that any incomplete or erroneous agent changes are fully reverted, protecting document integrity.

---

## Status Management

Agent status affects what operations are permitted.

### Status Enforcement Points

1. **Worker Level (Phase 7.4):** Status checked before forwarding to Durable Object
2. **Durable Object Level:** Status re-validated within session

### Status Check Behavior by Endpoint

| Endpoint | Status Check | Behavior |
|----------|--------------|----------|
| `can-agent-edit` | Required | Returns 403/404 if agent is not active |
| `agent-edit-start` | Required | Returns 403/404 if agent is not active |
| `agent-edit-complete` | Optional | Only checks if `X-Agent-Id` header present |
| `agent-edit-abort` | Optional | Only checks if `X-Agent-Id` header present |

### Update Agent Status

Administrators can update agent status:

```http
PATCH /api/organizations/{orgId}/agents/{agentId}
Content-Type: application/json

{
  "status": "suspended"
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | When Returned |
|------|---------|---------------|
| 200 | Success | Request processed successfully |
| 400 | Bad Request | Invalid request body or missing required fields |
| 403 | Forbidden | Agent is suspended or disabled |
| 404 | Not Found | Agent not found in registry |
| 405 | Method Not Allowed | Wrong HTTP method for endpoint |
| 415 | Unsupported Media Type | Content-Type is not application/json |
| 500 | Internal Server Error | Database or system error |
| 503 | Service Unavailable | Durable Object temporarily unavailable |

### Error Response Format

```json
{
  "error": "Human-readable error message",
  "reason": "machine_readable_code"
}
```

### Common Error Codes

| Reason | Description |
|--------|-------------|
| `agent_suspended` | Agent status is 'suspended' |
| `agent_disabled` | Agent status is 'disabled' |
| `agent_not_found` | Agent ID not found in registry |
| `active_human_collaborator` | Human user is currently editing |
| `region_conflict` | Another agent is editing the same region |
| `session_expired` | Edit session has timed out |
| `invalid_session` | Edit session ID is invalid or already closed |
| `missing_edit_session` | Agent called `/apply` without an editSessionId |
| `edit_session_mismatch` | Edit session belongs to a different agent |

---

## Best Practices

### 1. Always Check Before Editing

```typescript
// Good: Check permission first
const canEdit = await checkAgentEdit(agentId, intent, regions);
if (canEdit.allowed) {
  const session = await startAgentEdit(agentId, intent, regions);
  // proceed with edits
}

// Bad: Start editing without checking
const session = await startAgentEdit(agentId, intent, regions);  // May fail
```

### 2. Use Specific Target Regions

```typescript
// Good: Specific regions
const regions = ['/content/title', '/content/meta/description'];

// Bad: Overly broad regions
const regions = ['/'];  // Claims entire document
```

### 3. Provide Meaningful Intent

```typescript
// Good: Clear intent
const intent = 'Fixing grammatical errors in paragraph 3';

// Bad: Vague intent
const intent = 'Making changes';
```

### 4. Handle Denials Gracefully

```typescript
const result = await checkAgentEdit(agentId, intent, regions);
if (!result.canEdit) {
  switch (result.reason) {
    case 'active_human_collaborator':
      // Wait and retry later
      await scheduleRetry(5000);
      break;
    case 'region_conflict':
      // Try different regions or wait
      await handleRegionConflict(result.conflictingRegions);
      break;
  }
}
```

### 5. Always Include editSessionId in Apply Calls

```typescript
// Good: Include editSessionId from the start response
const session = await startAgentEdit(agentId, intent, regions);
await applyEdit({
  actorId: agentId,
  editSessionId: session.editSessionId,  // REQUIRED for agents
  operations: [{ op: 'replace', path: '/content/title', value: 'New Title' }]
});

// Bad: Missing editSessionId - will fail with 400 error
await applyEdit({
  actorId: agentId,
  // editSessionId missing!
  operations: [{ op: 'replace', path: '/content/title', value: 'New Title' }]
});
```

### 6. Always Complete or Abort Sessions

```typescript
let session;
try {
  session = await startAgentEdit(agentId, intent, regions);
  await makeChanges(session.editSessionId);
  await completeAgentEdit(session.editSessionId);
} catch (error) {
  if (session) {
    await abortAgentEdit(session.editSessionId, error.message);
  }
  throw error;
}
```

### 7. Include Headers for Audit Trail

Even for operations where headers are optional, including them improves the audit trail:

```typescript
// Good: Always include agent context
await completeAgentEdit(sessionId, {
  headers: {
    'X-Agent-Id': agentId,
  }
});
```

---

## Example: Complete Agent Integration

```typescript
import { AgentClient } from './agent-client';

const agent = new AgentClient({
  agentId: 'agent-uuid',
  apiKey: 'api-key',
  baseUrl: 'https://api.example.com'
});

async function updateDocumentTitle(
  siteId: string,
  branchId: string,
  documentPath: string,
  newTitle: string,
  requestedBy?: string  // User ID if human-requested
) {
  const trigger = requestedBy ? 'human_requested' : 'autonomous';
  const intent = `Updating document title to "${newTitle}"`;
  const targetRegions = ['/content/title'];

  // Step 1: Check permission
  const permission = await agent.canEdit({
    siteId,
    branchId,
    documentPath,
    trigger,
    requestedBy,
    intent,
    targetRegions
  });

  if (!permission.canEdit) {
    console.log(`Edit denied: ${permission.reason}`);
    return { success: false, reason: permission.reason };
  }

  // Step 2: Start edit session
  const session = await agent.startEdit({
    siteId,
    branchId,
    documentPath,
    trigger,
    requestedBy,
    intent,
    targetRegions
  });

  try {
    // Step 3: Make changes (include editSessionId!)
    await agent.applyEdit({
      siteId,
      branchId,
      documentPath,
      editSessionId: session.editSessionId,  // REQUIRED for agents
      operations: [
        { op: 'replace', path: '/content/title', value: newTitle }
      ]
    });

    // Step 4: Complete session
    const result = await agent.completeEdit({
      siteId,
      branchId,
      documentPath,
      editSessionId: session.editSessionId
    });

    return { success: true, checkpointId: result.checkpointId };

  } catch (error) {
    // Abort on failure
    await agent.abortEdit({
      siteId,
      branchId,
      documentPath,
      editSessionId: session.editSessionId,
      reason: error.message
    });

    throw error;
  }
}
```

---

## API Reference Summary

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/organizations/{orgId}/agents` | Register a new agent |
| GET | `/api/organizations/{orgId}/agents/{id}` | Get agent details |
| PATCH | `/api/organizations/{orgId}/agents/{id}` | Update agent (including status) |
| DELETE | `/api/organizations/{orgId}/agents/{id}` | Delete agent |
| POST | `.../documents/{path}/can-agent-edit` | Check edit permission |
| POST | `.../documents/{path}/agent-edit-start` | Start edit session |
| POST | `.../documents/{path}/agent-edit-complete` | Complete edit session |
| POST | `.../documents/{path}/agent-edit-abort` | Abort edit session |

### Header Reference

| Header | Type | Description |
|--------|------|-------------|
| `X-Agent-Id` | string | Agent UUID (max 128 chars) |
| `X-Agent-Trigger` | enum | `human_requested` or `autonomous` |
| `X-Agent-Requested-By` | string | User UUID who requested action |
| `X-Agent-Intent` | string | Description of intent (max 1000 chars) |
| `X-Agent-Operation-Type` | string | Operation category (max 100 chars) |
| `X-Agent-Target-Regions` | string | Comma-separated JSON paths (max 100 regions) |

---

## Troubleshooting

### Agent Receives 403 Forbidden

1. Check agent status: Is it `active`?
2. Verify agent ID exists in the organization
3. Ensure API key is valid and matches the agent

### Edit Permission Denied

1. Check if human users are active on the document
2. Verify target regions don't conflict with other editors
3. Wait for idle timeout (org-configurable, default 5 seconds)

### Session Expired

1. Complete edits within the session timeout
2. For long operations, periodically extend the session
3. Consider breaking large edits into smaller sessions

### Changes Not Persisted

1. Ensure `agent-edit-complete` was called
2. Check the response for checkpoint ID
3. Verify WebSocket operations were acknowledged

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-26 | Initial documentation for Phases 7.1-7.4 |
| 1.1 | 2026-01-28 | Added edit session enforcement for /apply endpoint, checkpoint lifecycle documentation |
