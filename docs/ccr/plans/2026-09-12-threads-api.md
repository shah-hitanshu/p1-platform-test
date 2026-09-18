# Threads API (PCC-3963) Implementation Plan

**Goal:** Give the editor's commenting prototype (PCC-3926) a backend in the CCR worker: threaded comments anchored to a block, page, site, or workstream, with mentions of users and agents, resolve/reopen, and per-page and per-site listings that carry counts and resolved state.

**Architecture:** Two new tables in the `app` schema (`comment_threads`, `comments`) managed through Drizzle, constrained to one *open* thread per context so a later "new thread after resolve" needs no migration; one service folder (`services/threads/`) that owns all SQL, row factories, cursor and mention handling; models under `types/threads/`; one route module under `routes/threads/` in the house shape (method check, permission gate, validation, `jsonResponse`, structured logs). Authorization adds a `canComment` flag to `RolePermissions` that every existing role except `NO_ACCESS` carries. No new named role, no new wrangler var, no server-side feature flag.

**Tech stack:** Cloudflare Worker, Drizzle over Postgres via Hyperdrive, Vitest. Migration `0010_*` generated with `pnpm db:generate`.

---

## Key design decisions

### Threads are site-scoped; at most one *open* thread per context

A thread is anchored to `(site_id, context_type, context_id)`. The invariant the schema enforces is **at most one open thread per context**, via a partial unique index `WHERE status = 'open'`. Several resolved threads may sit on the same block; the MVP just never creates a second one.

MVP behaviour lives in the service, not the schema: `POST /threads` looks up the thread for the context in any status, appends to it, and reopens it if it was resolved. When product wants "resolve, then start a fresh thread on the same block", that is a service change plus a client opt-in (for example `newThread: true` on the same request); the partial index keeps the race safe and no migration is needed. The response always returns the thread the comment landed in, so clients never assume which one that was.

Block ids (`props.id`, `Type-uuid`) are minted once and survive merges, so a thread follows the block across branches rather than forking per workstream. This matches what the frontend already assumes: `ThreadContext` on `claude/threads-comment-trigger` carries a single optional `threadId` per trigger, and PCC-3962 renders one count and one resolved mark per block.

`branch_id` is recorded on the thread as provenance (where it was opened) and is not a filter. A `?branchId=` filter can be added later without a schema change.

### Overview lists collapse to one thread per context; the context route returns them all

The page and site listings (`GET /threads`) are for drawing indicators, so they return **one overview per context**: the open thread if there is one, otherwise the most recently updated resolved thread. Today that is every thread; once multiple threads per context exist it stays one row per block without the UI changing.

The full history of a context is a separate read, `GET /contexts/{contextType}/{contextId}/threads`, which returns every thread on that object newest first. Not needed by any MVP ticket; specified now so the door stays open and the URL is settled. The UI renders the set however it wants.

### Context mirrors the frontend type

```ts
type ThreadContextType = 'block' | 'page' | 'site' | 'workstream';
interface ThreadContextRef { type: ThreadContextType; id: string }
```

| type | `id` is | `documentId` |
|---|---|---|
| `block` | the block's `props.id` | required |
| `page` | the document id | required, equals `id` |
| `workstream` | the branch id | omitted |
| `site` | the site id | omitted |

Page identity is the document id, not the path: the editor has `doc.id` in hand (`P1PuckProvider`), and a path rename would otherwise orphan every thread on the page. This is a coordination point with PCC-3957, whose doc-comment says "the page path" as an example; the API takes the id.

### Permissions: `canComment`, not a role

`RolePermissions` gains `canComment: boolean`. `ROLES` sets it `true` for `VIEWER`, `EDITOR`, `ADMIN` and `false` for `NO_ACCESS`. Writes (post, resolve, reopen) assert `canComment`; reads assert `canView`. Resolve is a signal, not a lock (Nick, PCC-3926), so it needs only `canComment`.

Permissions are branch-scoped and threads are not, so the site's main branch stands in for "this site" exactly as `routes/site-members` does. Known limitation shared with `/members`: a principal holding only a non-main branch grant cannot see main and gets 403 here.

Service principals (`sat_` tokens) have no scope granting the `threads` handler, so they are refused before dispatch. Agents authorize through their site role as usual; an agent acting for a user is min'd with that user, so `canComment` is checked against the effective role.

Also update the role table in `docs/ccr/hybrid-authorization-design.md`.

### No server-side flag gate

`p1-collaboration` is evaluated in the browser keyed on the user's email (PCC-3957). A worker-side gate would evaluate on a `site` context and could 404 the API while the UI shows the feature. The endpoints are additive and permission-checked, so the UI flag is the toggle. Revisit if the endpoints ever need to be dark independently of the UI.

### Posting on a resolved thread reopens it

`POST .../comments` on a `resolved` thread sets `status = 'open'`, clears `resolved_*`, and the response's `thread.status` reflects that. Clients do not need a separate reopen call after replying.

### Editing a comment is not built, but nothing blocks it

Not a requirement yet; the MVP ships no edit route. What is in place so it lands as a pure addition:

- `comments.edited_at` and `deleted_at` exist from migration 0010, and `Comment.editedAt` is on the wire (always `null` for now), so clients need no shape change to show "edited".
- Mentions live in the body, so an edit is a single `UPDATE comments SET body, edited_at` followed by the same parse-and-validate as a post. There are no mention rows to reconcile.
- The future route is `PUT /api/sites/{siteId}/threads/{threadId}/comments/{commentId}` with `{ body }`; the parser gains a `commentId` param and dispatch a new case. Nothing existing moves.
- Editing does not touch the thread: `updated_at`, `lastCommentAt` and `commentCount` stay put, so an edit never reorders the overview lists or reopens a resolved thread.
- Permission question deferred: author-only, or also `canComment` holders with an admin role. Neither needs a new column; `author_id` plus `acting_user_id` already identify the author.
- `ThreadEvent` gains a `comment_edited` variant when the route ships. Revision history, if ever wanted, is a new `comment_revisions` table written by the edit route; storing only the current body now does not preclude it.
- Soft delete is the same shape: set `deleted_at`, exclude from `commentCount` and from the thread read, keep the row.

### Every write emits one typed event

The socket work (PCC-3968, `2026-09-12-threads-realtime.md`) needs to know
when a comment lands or a thread changes status, and it needs to learn that after
commit without touching the service or the routes. So the seam is built now:

```ts
type ThreadEvent =
  | { type: 'comment_posted'; siteId: string; thread: ThreadOverview; comment: Comment }  // comment.mentions already parsed and hydrated
  | { type: 'thread_status_changed'; siteId: string; thread: ThreadOverview; actor: CommentAuthor };
```

Rules:

- The service is pure persistence. `postComment`, `replyToThread` and
  `setThreadStatus` return the committed `{ thread, comment }` / `thread` and
  emit nothing. Anything the event needs (`documentId`, `context`, `status`,
  author, `createdAt`) is already on those objects, so the event is built from
  the return value with no second query.
- The route handler, after a successful write, calls
  `emitThreadEvent(ctx, env, event)` from
  `routes/threads/events.ts` and returns the 201/200. In this PR that
  function logs `thread event` at debug and returns. PCC-3968 replaces its
  body with the presence lookup and Durable Object fan-out inside
  `ctx.waitUntil`; the call site, the service and the wire contract do not move.
- `dispatchRoute` already receives `ctx`; `case 'threads'` passes it through.
  Handlers without `ctx` (tests) get a no-op emit.
- Idempotency keys are the ids already in the payload: `comment.id` for
  `comment_posted`, `thread.id` plus `thread.updatedAt` for status changes.
  Clients dedupe on those, so re-emitting is harmless.

---

## Data model

All tables live in `app`. Actor columns follow `merge_requests` (`*_type text` + `*_id uuid`).

### `app.comment_threads`

| column | type | notes |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `site_id` | uuid not null, FK `sites` on delete cascade | |
| `context_type` | text not null, CHECK in (`block`,`page`,`site`,`workstream`) | |
| `context_id` | text not null | |
| `document_id` | uuid null, FK `documents` | the page a block/page thread lives on |
| `branch_id` | uuid null, FK `branches` on delete set null | provenance only |
| `status` | text not null default `open`, CHECK in (`open`,`resolved`) | |
| `created_by_type` / `created_by_id` | text / uuid not null | `user` or `agent` |
| `resolved_at` | timestamptz null | |
| `resolved_by_type` / `resolved_by_id` | text / uuid null | |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | bumped on every comment and status change; drives site-list ordering |

Indexes: partial unique `(site_id, context_type, context_id) WHERE status = 'open'` (Drizzle `uniqueIndex(...).where(sql\`status = 'open'\`)`, the same pattern `documents` uses for its archived-at index); `(site_id, context_type, context_id, updated_at desc)` for the context route and the overview collapse; `(site_id, document_id)`; `(site_id, updated_at desc)`.

### `app.comments`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `thread_id` | uuid not null, FK `comment_threads` on delete cascade | |
| `kind` | text not null default `message`, CHECK in (`message`) | PCC-3964/3966 widen the CHECK for agent proposal and activity rows |
| `body` | text not null | plain text; length enforced in the service |
| `metadata` | jsonb null | reserved for non-message kinds |
| `author_type` / `author_id` | text / uuid not null | |
| `acting_user_id` | uuid null | set when an agent posts on a user's behalf |
| `created_at` | timestamptz not null default now() | |
| `edited_at` / `deleted_at` | timestamptz null | columns only; edit and delete are out of scope |

Index: `(thread_id, created_at)`.

Drizzle files: `src/db/schema/comment-threads.schema.ts`, `comments.schema.ts`, exported from `src/db/schema/index.ts`. Generate `drizzle/0010_comment_threads.sql` with `pnpm db:generate`; the journal check (`pnpm db:check-journal`) must pass.

---

## Endpoints

Every route is nested under one site. There is no cross-site or organization-wide listing; an org with twenty sites makes twenty calls or, later, gets a dedicated org endpoint. Handler name `threads`, new `RouteParams.threadId`. Responses are `Cache-Control: private, no-store`.

| method | path | permission | purpose |
|---|---|---|---|
| `POST` | `/api/sites/{siteId}/threads` | `canComment` | Post the first comment on a context. Creates the thread if none exists, otherwise appends to the existing one. |
| `POST` | `/api/sites/{siteId}/threads/{threadId}/comments` | `canComment` | Reply to a known thread. Reopens if resolved. |
| `GET` | `/api/sites/{siteId}/threads/{threadId}` | `canView` | Thread overview plus all comments, oldest first. |
| `GET` | `/api/sites/{siteId}/threads?documentId=` | `canView` | One overview per context on a page (open thread preferred). |
| `GET` | `/api/sites/{siteId}/threads` | `canView` | One overview per context across the site (open thread preferred). |
| `GET` | `/api/sites/{siteId}/contexts/{contextType}/{contextId}/threads` | `canView` | Every thread ever opened on one object, newest first. |
| `PUT` | `/api/sites/{siteId}/threads/{threadId}/status` | `canComment` | `{ status: 'open' \| 'resolved' }`. |

Shorthand below drops the `/api/sites/{siteId}` prefix.

### Wire shapes

```ts
interface ThreadOverview {
  id: string;
  siteId: string;
  context: ThreadContextRef;
  documentId: string | null;
  status: 'open' | 'resolved';
  commentCount: number;
  lastCommentAt: string;          // ISO
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: CommentAuthor | null;
}

/**
 * Field names match the members roster (SiteMemberUser / SiteMemberAgent:
 * id, name, avatar) so the UI renders authors and roster entries with one
 * component. `requestedBy` mirrors ActorPresence.requestedById/Name.
 */
interface CommentAuthor {
  type: 'user' | 'agent';
  id: string;
  name: string | null;
  avatar: string | null;
  requestedBy?: { id: string; name: string | null };   // agent acting for a user
}

interface Comment {
  id: string;
  threadId: string;
  kind: 'message';
  body: string;                                        // mention tokens inline, see below
  author: CommentAuthor;
  mentions: Array<{ type: 'user' | 'agent'; id: string; name: string | null }>;
  createdAt: string;
  editedAt: string | null;                             // always null in this PR
}
```

There is no existing "who did this" wire type to reuse outright: `AuditActor` is id+type only, `ResolvableActor` is a persistence input, `ActorPresence` is a live-session shape. `CommentAuthor` is a `Pick` of the roster shapes plus `type`, exported from the route's `types.ts` next to them. Author names and avatars are resolved at read time by joining `app.users` and `app.agents`, so a rename shows everywhere and a departed member still has a name on old comments. Emails are not returned.

### Mentions travel inside the body; there is no mentions table

PCC-3960 completes a mention as the member's display name in the text. Names change and collide, so the body carries an id token, not a name:

```
Can ${mention|user:6f1c…} and ${mention|agent:9a02…} take a look?
```

Grammar: `${mention|` `user` \| `agent` `:` uuid `}`. The client's mention selector writes tokens; the client's comment component swaps them for chips using the hydrated `mentions` array. The body is the canonical record of who was mentioned. The server parses it on write to validate every token against the site roster (`getSiteMembers`) and rejects the whole comment on an unknown id; it parses it again on read and joins the roster to return `mentions: [{ type, id, name }]`. A member who has since left comes back with `name: null` and the UI shows a placeholder. Clients do not send a separate `mentions` array, and nothing about a mention is stored outside the body.

Why no table: hydration needs the roster at read time either way (a stored name goes stale), and the agent-reaction work consumes the parsed mentions from the `comment_posted` event, not from a query. The only thing a table would buy is an indexed "all comments mentioning X"; if that inbox ever ships, a `mention_ids uuid[]` column with a GIN index, backfilled by parsing bodies, is a one-column migration.

Anything that is not a well-formed token is ordinary text, which is what PCC-3960 wants for `@ ` and `@nobody`. Body length limits apply to the raw body including tokens.

**`POST /threads`** body:

```json
{
  "context": { "type": "block", "id": "Hero-3f2a…" },
  "documentId": "…",
  "branchId": "…",
  "body": "${mention|agent:9a02…} can we tighten this headline?"
}
```

Response `201 { thread: ThreadOverview, comment: Comment }`. The thread insert is `ON CONFLICT (site_id, context_type, context_id) DO NOTHING` followed by a select, then the comment insert, in one transaction, so two first-posters on the same block race to one thread and two comments.

**`POST /threads/{threadId}/comments`** body `{ body }`; response `201 { thread, comment }` with `thread.status` reflecting any reopen.

**`GET /threads/{threadId}`** → `200 { thread: ThreadOverview, comments: Comment[] }`.

**`GET /threads`** → `200 { threads: ThreadOverview[], nextCursor: string | null }`. One row per context: the open thread, else the latest resolved one (`DISTINCT ON (context_type, context_id) ORDER BY status = 'open' DESC, updated_at DESC`). Query: `documentId` (optional), `status` (`open` \| `resolved` \| `all`, default `all` because PCC-3962 needs resolved threads to draw the checkmark; `open` and `resolved` filter the collapsed rows), `limit` (default 100, max 500), `cursor` (opaque, from `(updated_at, id)`). Ordered by `updated_at desc`.

**`GET /contexts/{contextType}/{contextId}/threads`** → `200 { threads: ThreadOverview[] }`, every thread on that object, `updated_at desc`, no collapse. 400 if `contextType` is not in the union. Empty array, not 404, when the object has no threads.

**`PUT /threads/{threadId}/status`** body `{ status: 'open' | 'resolved' }`; response `200 { thread }`. PUT because it replaces one value idempotently; setting the same status is a no-op 200. Same shape as the existing `PUT /api/organizations/{orgId}/agents/{agentId}/status`.

### Validation (400 `{ error: 'Validation failed', invalidParams: [{ name, message }] }`)

- `body`: string, non-empty after trim, ≤ 10 000 characters.
- `context.type`: in the union; `context.id`: non-empty, ≤ 512 characters.
- `documentId`: required for `block` and `page`, must exist and belong to `siteId`; forbidden for `site` and `workstream`.
- `branchId`: optional; when present must belong to `siteId`.
- mention tokens parsed from `body`: ≤ 50; each `type` in the union and `id` a uuid; users must appear in the site roster and agents in the site's agent roster (`getSiteMembers`, already memoized). An unknown mention names the offending id and nothing is written.

### Errors

| status | when |
|---|---|
| 401 | unauthenticated (existing middleware) |
| 403 | `AuthorizationError` |
| 404 | site has no main branch; thread not found or belongs to another site (never leak existence across sites) |
| 405 | method not in the table above |
| 500 | anything else, logged with `outcome: 'error'` |

---

## Files

**Authorization**
- `workers/ccr/src/types/auth.ts` – `canComment: boolean` on `RolePermissions`, JSDoc written for a consumer.
- `workers/ccr/src/auth/roles.ts` – set per role.
- `docs/ccr/hybrid-authorization-design.md` – role table row.

**Schema and migration**
- `workers/ccr/src/db/schema/comment-threads.schema.ts`, `comments.schema.ts`, `index.ts`.
- `workers/ccr/drizzle/0010_comment_threads.sql` + `meta/` via `pnpm db:generate`.

**Service**
- `workers/ccr/src/services/threads/threads-service.ts` – `postComment(input)` (find-or-create thread + comment in one transaction, reopen on resolved), `replyToThread`, `getThread`, `listThreads` (collapsed per context), `listThreadsForContext`, `setThreadStatus`. Every function returns after commit and emits nothing; the returned `{ thread, comment }` is what the route turns into a `ThreadEvent`.

**Route**
- `workers/ccr/src/routes/threads/index.ts` – gate, validation, shaping, logging.
- `workers/ccr/src/types/threads/` – the models, one file each: `context`, `actor`, `thread`, `comment`, `mention`, `event`, `api` (wire contract above) and `limits`. `routes/threads/types.ts` holds only the route context.
- `workers/ccr/src/routes/threads/events.ts` – `emitThreadEvent(ctx, env, event)`; logs only in this PR (see "Every write emits one typed event").
- `workers/ccr/src/routes/route-parser.ts` – `threadId`, `contextType`, `contextId` params; matchers for `/threads`, `/threads/{id}`, `/threads/{id}/comments`, `/threads/{id}/status`, `/contexts/{type}/{id}/threads`.
- `workers/ccr/src/services/threads/mentions-service.ts` – token grammar, `parseMentions(body)`, `resolveMentions(siteId, body)` (roster check on write), `hydrateMentions` / `hydrateComments` on read; unit-tested on its own, and the same regex the UI's comment component will use. `factories.ts`, `rows.ts`, `cursor.ts` and `errors.ts` sit beside it.
- `workers/ccr/src/routes/route-dispatch.ts` – `case 'threads'` with `{ siteId, threadId, principal, masClient, ctx }`.

**Telemetry**
- `workers/ccr/src/telemetry.ts` – allow `thread_id`, `comment_id`, `context_type`, `thread_count`, `comment_count`, `mention_count`.

Log lines: `comment posted` (`site_id`, `thread_id`, `comment_id`, `context_type`, `mention_count`, `reopened`, `duration_ms`, `outcome`), `threads listed` (`site_id`, `thread_count`, `duration_ms`), `thread status changed`, `threads denied` on 403, `threads route failed` on 500.

---

## Tests

- `tests/auth/roles.spec.ts` – leave untouched; add `tests/auth/can-comment.spec.ts` asserting the flag per role (mirrors `can-manage-templates.spec.ts`).
- `tests/types/types.spec.ts` builds a `RolePermissions` literal; it needs `canComment` added to the fixture or the test-typecheck ratchet rises. Fixture addition only, called out in the PR.
- `tests/routes/threads/*.spec.ts` – method/permission matrix (viewer can read and post; NO_ACCESS gets 403; service principal refused), validation table, 404 for a thread on another site, reopen on reply, resolve/reopen idempotence, list filters and paging.
- `tests/db/threads.spec.ts` – find-or-create under a concurrent first post yields one thread; cursor ordering; with a resolved and an open thread seeded on one context (inserted directly, since the API cannot create that state yet) the overview list returns only the open one and the context route returns both.
- Real-DB spec under `test:db` for the transaction and unique-index behaviour.
- `pnpm --filter ccr-worker typecheck && lint && test`, `pnpm check:typecheck-tests` at the ceiling, `pnpm db:check-journal`.

---

## Out of scope, handed to siblings

- Socket notification of a new comment (PCC-3968): replaces the body of `emitThreadEvent`; feasibility in `2026-09-12-threads-realtime.md`.
- Comment count in the block outline (PCC-3962): consumes `GET /threads?documentId=`.
- Agent proposal message kinds (PCC-3964, PCC-3966): widen the `kind` CHECK, fill `metadata`.
- Edit and delete comments; see "Editing a comment is not built, but nothing blocks it".
- `packages/css-client` `client.threads` endpoint for PCC-3965: separate small PR once the shapes here are stable.
- Archiving threads on branch delete or document archive.
- Starting a second thread on an already-resolved context (`newThread: true`); schema and list endpoints already allow it.
