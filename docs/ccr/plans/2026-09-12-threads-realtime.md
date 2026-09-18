# Threads over websockets: feasibility

Companion to `2026-09-12-threads-api.md`; tracked as PCC-3968. Scope: how a new comment reaches
other browsers on the site without a refresh (the "socket notification of new
messages" ticket), what the existing realtime layer gives us for free, where it
does not fit, and what I would build for the MVP.

## What exists today

**Sockets live on one Durable Object per (site, document, branch).**
`GET /api/sites/{siteId}/branches/{branchId}/documents/{path}/connect` upgrades
the connection in `routes/realtime-api.ts`, resolves the document by path, builds
`sessionId = "{siteId}:{documentId}:{branchId}"` and forwards to
`env.DOCUMENT_STATE.idFromName(sessionId)`. The `DocumentSession` DO accepts the
socket with the hibernation API (`acceptWebSocket`, `serializeAttachment`), so an
idle DO costs nothing while its sockets stay open, and `state.getWebSockets()`
returns them after a wake-up. Every connected editor has exactly one of these
sockets: `useRealtime.ts` creates one `RealtimeClient` per
(site, branch, documentPath, actor) and tears it down on change.

**There is no site-level socket.** `PresenceManager` (`PRESENCE.idFromName(siteId)`)
is an RPC-only index: `branchId → documentId → actorId → ActorPresence`, fed by
`actorJoined` / `actorLeft` / `focusChanged` / `stateChanged` calls from the
document DOs. It holds no sockets and cannot push. Its read side is exactly the
lookup a fan-out needs: `getSitePresence()` returns every actor with
`branchSummary[{branchId, actorCount}]`, `getBranchPresence(branchId)` returns
actors with `documentSummary[{documentId, actorCount}]`. The architecture doc's
"Branch Presence" DO with `subscribers` was never built; the shipped design moved
presence into the document socket instead.

**The protocol is a discriminated union.** Server-to-client messages are
`WsServerMessage` in `workers/ccr/src/types/websocket-messages.ts`
(`presence_update`, `focus_region_broadcast`, `focus_region_ack`, `presence_error`,
`delivery_ack`, `publish_result`, `sync_baseline`) with a mirror in
`packages/css-client/src/types.ts`. The client switch is `handleTextMessage` in
`packages/css-client/src/realtime.ts`; each variant maps to a config callback
(`onPresenceUpdate`, `onFocusRegionBroadcast`, ...). Adding a variant is additive
on both ends and unknown types are already ignored by old clients.

**Pushing into a DO from a request is an established pattern.** `template-api.ts`
does `stub.fetch(new Request('http://internal/reload'))` after a publish, wrapped in
`ctx.waitUntil` so the HTTP response is not held up. `presence-rollup-service.ts`
reads `/presences` with an `X-Session-Id` header. The DO's internal router in
`document-session.ts` already distinguishes metadata-only paths that call
`initializeMetadataIfNeeded()` and never load the CRDT; a notification path
belongs in that group. `dispatchRoute` receives `ctx` today, so the threads
handler can take it without plumbing changes.

## The mismatch

| | Socket identity | Thread identity |
|---|---|---|
| keyed by | site + document + **branch** | site + context (+ `documentId` for block/page) |
| branch | required, UUID | provenance only |
| site/workstream contexts | no DO exists | valid thread contexts |

Two consequences:

1. A block or page thread names a document but not a branch. The same document
   has one DO per branch that anyone has open, so delivering to "everyone on this
   page" means finding those branches first. Block ids survive merges, so a
   comment on main is relevant to someone editing the same block on a feature
   branch. That is an argument for fanning out to all branches, not only the
   author's.
2. Site and workstream threads have no document to attach to. Only a site-wide
   channel or polling can carry them.

Also worth stating: PCC-3968 wants a badge count for threads the viewer is *not*
looking at ("same site, or maybe same page"). A per-document socket only reaches
people on that page. Cross-page counters need either a site channel or a poll of
`GET /threads?status=open`.

## Options

### A. Fan out through the document DOs (recommended for MVP)

After `threads-service` commits the comment, the route handler schedules a
push in `ctx.waitUntil` and returns 201 immediately:

```
PresenceManager(siteId).getSitePresence()          // one RPC, in-memory index
  → branches with actorCount > 0
  → for each: getBranchPresence(branchId)         // or a new getDocumentBranches(documentId)
  → keep branches whose documentSummary contains thread.documentId
  → DOCUMENT_STATE.idFromName(`${siteId}:${documentId}:${branchId}`)
      .fetch('http://internal/notify', { body: WsServerMessage })
```

The DO side is a new metadata-only path in `document-session.ts` that calls
`initializeMetadataIfNeeded()` and `broadcast` over `state.getWebSockets()` using
the existing `sendWsMessage`. It never touches the Y.Doc, so the wake-up is cheap
and it cannot disturb the sync gate.

Message, ids only, no body text:

```ts
interface CommentPostedMessage {
  type: 'comment_posted';
  threadId: string;
  commentId: string;
  context: ThreadContextRef;
  documentId: string | null;
  status: 'open' | 'resolved';
  authorId: string;
  createdAt: string;
}
```

The client dedupes on `commentId` (per PCC-3968: known id → no-op; unknown id →
increment counters, or fetch the thread if the panel is open). Status changes
(`PUT .../status`) reuse the same shape with a `thread_status_changed` type so
resolve/reopen also propagates.

Filtering to the right recipients is free: everyone with a socket on that
document already passed `canView` for the branch on connect, and the message
carries nothing the list endpoint would not return them.

**Adding one RPC to `PresenceManager`** is worth it: `getDocumentBranches(documentId)`
walking the existing index returns the branch ids in one call instead of N+1.
Small, RPC-only, no storage change.

Cost: one PresenceManager RPC plus one `fetch` per branch that has the document
open. Typical sites have one or two. `waitUntil` runs after the response, so
comment latency is unaffected; failures are logged and dropped (the list endpoint
is the source of truth, so a missed push is a stale badge, not lost data).

What it does not cover: site/workstream threads, viewers on other pages, and
viewers on branches where nobody else is present are fine (they are present
themselves). A comment from someone with no socket at all (API, agent) still
fans out because the lookup is by presence, not by author.

### B. Site-level channel DO

A new `SiteChannel` DO (`idFromName(siteId)`) that accepts a second hibernating
socket from every editor and broadcasts site-scoped events: `comment_posted`,
status changes, and later anything else site-wide (member changes, publish done).
The threads handler pushes once, to one DO, regardless of context type.

This is the right end state. It covers site and workstream threads and cross-page
counters, and it decouples "notify the site" from document sync. It is also the
larger change: a new DO class and migration in `wrangler.jsonc` for all three
lanes, a second connect route with its own auth check, a second `RealtimeClient`
instance (or a multiplexing layer) in `css-client`, reconnect/backoff, and
PresenceManager-style tests. Roughly the size of the API work itself.

Middle path if we go here later: keep option A's message shape and DO-side
`/notify` handler, and swap the fan-out target from N document DOs to one
`SiteChannel`. Nothing in the client changes except which socket delivers it.

### C. Polling

The threads panel polls `GET /api/sites/{siteId}/threads?status=open`
on an interval and diffs `commentCount` / `lastCommentAt`. Zero backend work,
works for every context type, and it is the fallback the UI needs anyway for
the first paint and for reconnects. 30 s intervals across a site's editors is
negligible load against an indexed read.

Not a replacement for A in the editing surface: a comment on the block you are
looking at should appear in under a second, not in 30.

## Recommendation

Ship A plus C for the MVP, designed so B is a swap rather than a rewrite:

1. **Server:** the API PR already routes every write through
   `emitThreadEvent(ctx, env, event)` in `routes/threads/events.ts`
   with a typed `ThreadEvent` (log-only there). This work replaces that
   function's body with the presence lookup and fan-out inside `ctx.waitUntil`. New `PresenceManager.getDocumentBranches`.
   New `/notify` path in the document DO router (metadata-only). New
   `comment_posted` and `thread_status_changed` variants in `WsServerMessage`.
2. **Client:** mirror the variants in `packages/css-client/src/types.ts`, add
   `onCommentPosted` / `onThreadStatusChanged` to `RealtimeClientConfig`, handle
   them in `handleTextMessage`, expose them through `useRealtime.ts`. The
   threads feature keeps a `Set<commentId>` for dedupe and refetches the
   thread when the panel for that context is open.
3. **Counters for other pages / site threads:** poll the collapsed list on an
   interval and on socket reconnect. Revisit B when site or workstream threads
   get a UI, or when a second site-wide event shows up (publish notifications
   are the likely one).

Same socket as presence: yes. It is already authenticated, already hibernation-safe,
already reconnects, and the client already switches on message type. A second
socket per editor for the MVP would double connection count for a feature that
only needs a few bytes per comment.

## Risks and open questions

- **DO wake cost.** `/notify` must stay metadata-only. If someone later routes it
  through the CRDT initialization path, every comment on a site would load Y.Docs
  for every open branch. Guard with a test that `/notify` on a fresh DO does not
  call the snapshot loader.
- **Delivery is best-effort, at-most-once.** `waitUntil` can be cut short on
  isolate eviction and a hibernating DO can drop a socket between `getWebSockets`
  and `send`. The UI must treat the push as a hint and reconcile from the list
  endpoint (C) on reconnect and on interval.
- **Presence lag.** PresenceManager is fed by document DOs; an actor who
  connected in the last few hundred milliseconds may not be indexed yet and will
  miss the push. Acceptable for a badge; the panel refetches on open.
- **Ordering.** Two comments posted within the same second can arrive out of
  order across branches. Clients should sort by `createdAt` from the API, not by
  arrival.
- **Parked from the API review:** the mention-token grammar. If mentions later
  need their own push ("you were mentioned"), the fan-out target is a user, not
  a document. `getSitePresence()` already exposes `actorId` per location, so
  option A can deliver to a specific user's sockets wherever they are on the
  site; option B would deliver it once. Neither needs schema changes.
- **Local dev.** Miniflare lacks `state.id.name`; `/notify` must accept the
  `X-Session-Id` header like `/presences` does, or local pushes land on an
  "unknown" session and are dropped.
