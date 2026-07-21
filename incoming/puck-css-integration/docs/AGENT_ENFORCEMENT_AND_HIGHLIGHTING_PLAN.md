# Agent Enforcement and Highlighting Implementation Plan

## Overview

This plan covers two related features for the collaborative editing system:

1. **Server-Side Enforcement of Human Focus Protection** - Prevent agents from making changes to parts of a document where humans are actively focused (assume focus = intent to edit). This must be enforced by the server to prevent bad client implementations from bypassing the rules.

2. **Agent Activity Region Highlighting** - Show with the same region highlighting logic what parts of a document an agent is actively writing to. This provides visual feedback to humans about where agents are working.

## Feature 1: Server-Side Enforcement

### Current State

The Agent Politeness Protocol exists with three phases:
- `canEdit()` - Advisory check if agent can edit target regions
- `startEdit()` - Reserve regions, get sessionId, create checkpoint
- `completeEdit()` / `abortEdit()` - Finish the session

However, this is currently **advisory only**. A misbehaving agent client could:
1. Skip calling `canEdit()` entirely
2. Start editing without calling `startEdit()`
3. Send WebSocket CRDT updates directly, bypassing all checks

### Design Goals

1. **Server-enforced rejection** of agent CRDT updates that modify components where humans have focus
2. **Graceful failure** with clear error messages to the agent
3. **No breaking changes** for existing human users
4. **Session-based authorization** - agents must have a valid edit session to make changes

### Implementation Approach

The server (`collaborative-state-system`) will:

1. **Track human focus regions per document** (already done via presence)
2. **Require sessionId for agent CRDT updates** (already supported via WebSocket query param)
3. **Parse incoming CRDT updates** to determine affected component paths
4. **Check for conflicts** between affected paths and human focus regions
5. **Reject conflicting updates** with a WebSocket error message

### Phase 1A: CRDT Update Path Detection

**Location:** `collaborative-state-system/workers/src/durable-objects/document-session.ts`

Extract affected paths from Yjs update:
- Parse the binary Yjs update
- Determine which content indices or zone paths are modified
- Convert to focus region path format (`/content/N`, `/zones/X/N`)

**Technical approach:**
- Apply the update to a cloned Y.Doc to inspect changes
- Compare before/after to identify modified paths
- Use Yjs's transaction observer pattern

### Phase 1B: Human Focus Protection Check

**Location:** `collaborative-state-system/workers/src/durable-objects/document-session.ts`

Before applying an agent's CRDT update:
1. Get the agent's connection (identified by `actorId` + `actorType: 'agent'`)
2. Get all human actors with focus regions from presence
3. Check if any human focus regions overlap with the update's affected paths
4. If conflict: Reject the update, send error message to agent
5. If no conflict: Apply the update normally

**Overlap detection:**
- Exact match: `/content/0` conflicts with `/content/0`
- Prefix match (optional): `/content/0` conflicts with `/content/0/zones/X`

### Phase 1C: WebSocket Error Message

**New message type:** `WsEditRejectedMessage`

```typescript
interface WsEditRejectedMessage {
  type: 'edit_rejected';
  reason: 'human_focus_conflict';
  conflictingRegions: string[];
  humanActors: Array<{ actorId: string; name: string }>;
  timestamp: number;
}
```

The agent client will receive this error and can:
- Retry later
- Target different regions
- Request human approval

### Phase 1D: Client-Side Error Handling

**Location:** `puck-css-integration/packages/css-client/src/realtime.ts`

Add handling for the `edit_rejected` message:
- Parse the message
- Call `onEditRejected` callback if provided
- Allow agents to handle the rejection gracefully

### Phase 1E: Agent Session Validation (Optional Enhancement)

Optionally enforce that agents must have an active edit session:
- No sessionId → reject all binary updates from agents
- Invalid/expired sessionId → reject with `session_invalid` error
- Valid sessionId → proceed to focus conflict check

This is an optional enhancement that can be phased in after the basic protection works.

---

## Feature 2: Agent Activity Region Highlighting

### Current State

The focus region highlighting system already exists:
- `focusRegionMap.ts` - Maps focus region paths to component IDs
- `createFocusHighlightConfig()` - Wraps Puck config to add highlight overlays
- `FocusHighlightContext` - Provides focus map to components without recreating config
- CSS styles for `.focus-region-highlight` and `.focus-region-highlight--editing`

The system processes **all actors** in presence, not just humans:
```typescript
export function createFocusRegionMap(
  data: PuckData,
  actors: ActorPresence[]  // All actors, including agents
): Map<string, FocusHighlight>
```

### Gap Analysis

The highlighting should already work for agents if:
1. Agents report their `focusRegions` during editing
2. The presence data includes agents with `focusRegions`
3. The UI passes all actors (not just humans) to the focus map

**Verification needed:**
1. Does `startEdit()` set the agent's `focusRegions` in presence?
2. Does the demo app pass all actors (not just humans) to focus highlighting?
3. Are agent highlights visually distinguishable from human highlights?

### Phase 2A: Verify Server-Side Agent Focus Region Setting

**Location:** `collaborative-state-system/workers/src/durable-objects/document-session.ts`

When an agent calls `agent-edit-start`:
1. The agent's presence record should include `focusRegions: targetRegions`
2. The agent's `state` should be `'editing'`
3. The presence update should be broadcast to all clients

**Current implementation check:**
- Commit `11d1dab` added `state: 'editing'` to agent presence
- Need to verify `focusRegions` is also set from `targetRegions`

### Phase 2B: Verify Client-Side Focus Map Includes Agents

**Location:** `puck-css-integration/apps/demo/src/App.tsx`

The demo app creates `focusMap` from presence actors:
```typescript
const focusMap = useMemo(() => {
  const otherActors = presence?.actors.filter(a => a.actorId !== userId) ?? [];
  return createFocusRegionMap(dataForFocusMap, otherActors);
}, [presence?.actors, userId, dataForFocusMap]);
```

This should already include agents. Verify:
1. `presence?.actors` includes agents
2. Agents are not filtered out

### Phase 2C: Visual Differentiation for Agent Highlights

**Location:** `puck-css-integration/packages/puck-css/src/styles.css`

Currently all highlights use the same styling based on actor ID color. Consider adding:
- Different outline style (dashed vs solid) for agents
- Robot/lightning bolt icon instead of avatar initial
- Subtle animation to indicate active agent work

**Proposed CSS:**
```css
.focus-region-highlight--agent {
  border-style: dashed;
}

.focus-region-highlight--agent .focus-region-highlight__badge {
  /* Lightning bolt icon instead of initial */
}
```

### Phase 2D: Update focusHighlightConfig for Actor Type

**Location:** `puck-css-integration/packages/puck-css/src/utils/focusHighlightConfig.ts`

Add `actorType` to the highlight wrapper:
```typescript
data-actor-type="${highlight.actorType}"
```

Then CSS can target:
```css
[data-actor-type="agent"] { border-style: dashed; }
```

This requires:
1. Adding `actorType` to `FocusHighlight` interface in `focusRegionMap.ts`
2. Passing `actorType` from `ActorPresence` when creating highlights
3. Including `data-actor-type` in the wrapper HTML

---

## Implementation Order

### Phase 1: Server-Side Enforcement (collaborative-state-system)

| Step | Description | Location | Tests |
|------|-------------|----------|-------|
| 1A | Parse CRDT updates to extract affected paths | document-session.ts | 5-8 tests |
| 1B | Human focus protection check | document-session.ts | 5-8 tests |
| 1C | WsEditRejectedMessage type and sending | document-session.ts | 3-5 tests |
| 1D | Client error handling | realtime.ts | 4-6 tests |

### Phase 2: Agent Highlighting (puck-css-integration)

| Step | Description | Location | Tests |
|------|-------------|----------|-------|
| 2A | Verify server sets agent focusRegions | collaborative-state-system | verify existing |
| 2B | Verify client includes agents in focusMap | demo/App.tsx | manual test |
| 2C | Add CSS for agent highlight differentiation | styles.css | visual test |
| 2D | Add actorType to highlight config | focusRegionMap.ts, focusHighlightConfig.ts | 3-5 tests |

---

## Risks and Mitigations

### Risk 1: CRDT Update Parsing Complexity
- Yjs updates are binary and complex to parse without applying
- **Mitigation:** Apply to a cloned Y.Doc to inspect changes, or use Yjs transaction observer

### Risk 2: Performance Impact
- Parsing every update adds latency
- **Mitigation:** Cache human focus regions, only parse when agents send updates

### Risk 3: Race Conditions
- Human might focus on a region while agent update is in flight
- **Mitigation:** Last-write-loses is acceptable; human can see agent's changes and undo

### Risk 4: Breaking Existing Agent Implementations
- Agents that don't follow the protocol will suddenly fail
- **Mitigation:** Log warnings initially, enforce strictly after agents are updated

---

## Success Criteria

1. **Server Enforcement:**
   - Agent CRDT updates are rejected when modifying human-focused regions
   - Agents receive clear error messages with conflict details
   - Human edits are never blocked or delayed

2. **Agent Highlighting:**
   - Agent activity shows colored outlines on components they're editing
   - Agent highlights are visually distinguishable from human highlights
   - Highlights update in real-time as agents work

---

## Design Decisions (2026-01-30)

| # | Question | Decision |
|---|----------|----------|
| 1 | Focus vs Edit State | Protect `focusRegions` - focus implies intent to edit or review |
| 2 | Granularity | Component level (path format supports zones) |
| 3 | Grace Period | Immediate enforcement, no grace period |
| 4 | Human-requested override | Exempt - human-requested agent actions bypass locking for now |
| 5 | Visual differentiation | No - use same hash-based color scheme for agents and humans |
| 6 | Implementation order | Feature 2 (highlighting) first, then Feature 1 (enforcement) |

**Rationale for Decision #4:** If a human not involved in live editing asks an agent to do something, the agent should be able to proceed without being blocked by other humans editing live. Adding "on behalf of" UUID complexity is deferred.

---

## Next Steps

1. Review this plan and get approval
2. Decide on open questions
3. Begin with Phase 2 (highlighting) as it's lower risk and provides immediate value
4. Implement Phase 1 (enforcement) with careful testing
