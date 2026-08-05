# Component registry casing — root-cause research

Research for PCC-3561 ("MCP Tools able to create components with different case
convention"). Traces component-type identity from every writer to the database
and back to the renderer, explains why the casing is the way it is, and
enumerates every gap that lets a mis-cased type survive.

## TL;DR

Two independent casing regimes collide inside one storage system:

| | Owner | Casing | Sensitivity |
|---|---|---|---|
| **Document paths** (incl. `_registry/components/*`) | CSS backend | forced lowercase | case-**in**sensitive by design — deliberately, for page URLs; the registry inherits it by accident |
| **Component types** (`content[i].type`, `config.components` keys) | Puck | PascalCase by convention | case-**sensitive**, no fallback |

The registry stores descriptors *as documents*, so component names inherit the
document store's lowercasing on the **path**, while the true casing survives
only in the descriptor **body**'s `name` field.

To cope, both sides grew a `registryComponentKey(name) => name.toLowerCase()`
shim so lookups still match. That shim fixed a re-registration loop but made
every registry lookup **case-blind** — and no writer ever rewrites the incoming
`type` to the canonical casing. So `quoteblock` finds `QuoteBlock`'s schema,
passes every validation check, and is written verbatim into the document. Puck
then can't resolve it, and the block is invisible/broken.

**The defect is not a missing check. It is a check that matches
case-insensitively but never canonicalizes.**

---

## 1. Where casing is decided

### 1a. Document paths are lowercased server-side

`workers/collaborative-state/src/services/document-types.ts:389`

```ts
// Convert to lowercase for case-insensitive matching
normalized = normalized.toLowerCase();
```

`normalizePath` is applied on create (`routes/document-api.ts:332`), rename,
get-by-path, and `pathPrefix` list filters (`services/document-service.ts:101,
163, 197, 272, 305`). `validatePath` (`document-types.ts:427`) checks NULs,
control chars, traversal and whitespace — **it does not check casing**.

This is correct and deliberate *for content pages*: `/About` and `/about` must
be the same page. The registry piggybacks on the same document store and
inherits it as a side effect.

Note that `_registry/` is **not homogeneous**. Six subtrees live under it —
`components`, `templates`, `redirects`, `queries`, `datasources`, and the
`index` — and they do not all want the same treatment. In particular
`_registry/redirects/{path}` keys on a **page path**: `redirect-content-api.ts:20`
passes a visitor-supplied URL straight into `getDocumentByPath` and relies on
`normalizePath` lowercasing it to match. Case-insensitive page routing is an
explicit product requirement (PCC-3274). Any exemption from lowercasing must
therefore be scoped to `_registry/components/`, never to `_registry/` as a whole.

### 1b. Component types are PascalCase and case-sensitive

`apps/p1-starter/puck.config.tsx:44`

```ts
components: {
  HeadingBlock: headingBlock,
  ParagraphBlock: paragraphBlock,
  QuoteBlock: quoteBlock,
  ...
}
```

Puck resolves `content[i].type` by **exact key lookup** into
`config.components`. Verified in the installed `@puckeditor/core@0.21.1`, not
assumed: roughly twenty resolution sites across `dist/`, every one a plain
bracket lookup with no `toLowerCase`, no key scan, and no fallback.

The render path is the decisive one — `chunk-EBISZQTK.mjs:4124`:

```js
const Component = config.components[item.type];
...
const richtextProps = useRichtextProps(Component.fields, props);
```

No optional chaining, no guard. A miss makes `Component` undefined and the next
line throws `TypeError: Cannot read properties of undefined (reading 'fields')`.
So a mis-cased type is a **hard crash, not a skipped block** — which is why the
reporter saw the editor error rather than silently omit the component. There is
also no unknown-component guard anywhere in this repo (verified by grep across
`packages/` and `apps/`).

Puck asserts this in its own types too, though only conditionally.
`ComponentDataMap` (`actions-BkBoKAc5.d.ts:510`) binds `type` to the literal key
`K`, so with the config generics parameterised `type` narrows to a union of the
config's component keys and `"quoteblock"` is a compile error. But
`type MappedItem = ComponentData` takes all defaults, which leaves
`Name = string` and no narrowing. Compile-time protection is opt-in via generics
— and irrelevant to this bug either way, since MCP writes arrive as runtime JSON
over a network boundary where TypeScript has no reach. Enforcement has to be
runtime, at the write boundary.

### 1c. So the source of truth is the body, not the path

`packages/puck-css/src/editor/utils/componentRegistry.ts:214` writes `name`
into the descriptor from the config key, preserving true case. The path loses
it. Every consumer therefore has to prefer `snapshot.name` over the
path-derived name — and they mostly do
(`packages/p1-content-validator/src/registry.ts:49`,
`workers/css-mcp-server/src/shared/tools.ts:1605`). The exceptions are gap #5
below.

---

## 2. Flow: client (editor) → DO → DB

**Registry write.** `packages/puck-css/src/editor/useComponentRegistry.ts:65`
runs on editor open:

1. `extractDescriptors(puckConfig)` — names come from
   `Object.entries(config.components)` keys → true PascalCase
   (`componentRegistry.ts:282`).
2. `syncComponentRegistry` (`editor/utils/syncComponentRegistry.ts`) issues
   `documents.create({ path: '_registry/components/QuoteBlock' })` +
   `versions.create({ snapshot: descriptor })`.
3. Server normalizes the path → row stored at
   `_registry/components/quoteblock`. The snapshot lands in
   `document_versions.snapshot JSONB` (`db/migrations/001_core_schema.sql:96`)
   holding `name: "QuoteBlock"` verbatim. **No constraint on snapshot
   contents.**
4. On the next open, `documents.list({ pathPrefix: '_registry/' })` returns
   lowercased paths. `registryComponentKey` (`syncComponentRegistry.ts:61`)
   lowercases descriptor names so they match:

   > The server's normalizePath lowercases every document path on write, so a
   > component registered as HeroBlock lists back at
   > `_registry/components/heroblock`. Every in-memory lookup that matches
   > descriptor names against path-derived names (or index hash keys) must go
   > through this key, or PascalCase components never match their own documents
   > and re-register on every load.

   That comment records the earlier incarnation of this bug: without the shim,
   every PascalCase component re-registered on every editor load.

**CI variant.** `apps/p1-starter/scripts/sync-puck-registry.ts` →
`syncComponentRegistryWriteOnly`, using a `write:registry`-scoped token that has
no read access, so it rewrites every descriptor unconditionally.

**Content write.** Editor-authored `content[i].type` values come from Puck config
keys by construction. **The client cannot produce a mis-cased type.** This is
why the bug is MCP-only — and why it went unnoticed: the only writer that was
structurally incapable of the mistake was the only writer being exercised.

---

## 3. Flow: MCP → DO → DB

Two independent MCP surfaces implement the same tool names:

- `workers/css-mcp-server/src/shared/tools.ts` — `apply_document_edits`, `create_page`
- `workers/p1-agent/src/tools.ts` — same names, separate implementation
  (this is the ticket's repro path: *"Used p1-agent: apply document edits"*)

### Read side — how the agent learns component names

| Surface | Source | Casing |
|---|---|---|
| css-mcp-server `list_components` (`tools.ts:1605`) | prefers `descriptor.name` | ✅ PascalCase |
| …its fallback (`tools.ts:1593`, `:1620`) | `componentNameFromPath(doc.path)` | ❌ lowercase |
| p1-agent `list_components` (`tools.ts:139`) | `c.name` from snapshot only | ✅ PascalCase |
| `fetchRegistrySchemas` (`api-client.ts:1259`) | keys by `registryComponentKey(schema.name)`, `schema.name` preserved | keys lowercase, name ✅ |

So the agent is *normally* told `QuoteBlock`. The ticket's agent was explicitly
instructed to lowercase it — but the lowercase fallback path means a descriptor
whose version fetch fails is advertised in lowercase, which would teach an agent
the wrong name unprompted.

### Write side — the actual defect

`packages/p1-content-validator/src/validator.ts:136`

```ts
const schema = registry[registryComponentKey(comp.type)];
if (!schema) { /* unknown_component_type */ }
```

`registryComponentKey` lowercases. `validateOps` additionally re-keys the whole
registry defensively (`validator.ts:345`). The lookup therefore succeeds for
`quoteblock`, `QUOTEBLOCK`, `QuOtEbLoCk` — and **`comp.type` is never rewritten
to `schema.name`**. Props, enum values, and the `props.id` format are all
validated against the correct schema, all pass, and the op is forwarded with the
caller's casing intact. Same hole at `validator.ts:244` for targeted prop
writes.

That is the whole bug, in one line.

### Every layer that could have caught it, and why it didn't

1. **`validateOps`** — matches case-insensitively, doesn't canonicalize. (above)
2. **Validation is optional and silently skippable.** css-mcp-server gates on
   `apiClient.validationEnabled` (`tools.ts:1395`, `:1702`; set true at
   `mcp-handler.ts:123`) and wraps the whole block in a `try/catch` that
   swallows everything — a registry fetch failure means *no validation*, with no
   error surfaced to the caller.
3. **Empty registry disables all validation.** `validator.ts:335` returns
   `{ errors: [] }` when the registry is empty. Intentional (the registry only
   populates after the editor first opens), but it means a fresh site accepts
   arbitrary component types. The ticket's site was created minutes earlier via
   the starter CLI.
4. **The backend does not validate at all.** `workers/collaborative-state`
   declares `@pantheon-systems/p1-content-validator` in `package.json:45` but
   **never imports it in `src/`** — the only references are `vi.mock` calls in
   tests. There is no server-side line of defense; every guarantee lives in the
   agent process.

### DO → DB

`workers/collaborative-state/src/durable-objects/postgres-sync-manager.ts:368`
→ `root.toJSON()` → `document_versions.snapshot`. The CRDT `Y.Map` is an opaque
key/value store; nothing inspects `type` on the way through.

One durable side effect: `services/component-identity.ts:111`

```ts
export function mintComponentId(type: string): string {
  return `${type}-${crypto.randomUUID()}`;
}
```

The caller-supplied casing is baked into `props.id` (`quoteblock-<uuid>`), which
then persists as the component's identity for pinning, migration, and dedupe.
`PREFIXED_UUID_RE` (`validator.ts:40`) accepts `[A-Za-z]`, so it validates fine.

---

## 4. Flow: read back → the visible failure

- **Editor** — `data.content[i].type === "quoteblock"`, no
  `config.components.quoteblock` → Puck fails to resolve. Matches the ticket's
  "errors in the visual editor".
- **Published page** — same resolution failure via `Render` → block absent.
  Matches "doesn't show in the published visible page".
- **Document JSON** — intact, which is why the ticket correctly guessed it's
  recoverable. Content-level checkpoint revert restores it.
- **`packages/puck-css/src/data/cross-reference.ts:143,184`** —
  `config.components[type]` exact lookup → `undefined` label, silent
  degradation.
- **Checkpoints** — `services/checkpoint-service.ts:193` excludes `_registry/*`
  from capture, so a revert can't restore registry descriptors (deliberate,
  PCC-3430). Content documents are unaffected.
- **Structure validation** — `structure-validator.ts:56` keys pinned slots on
  `props.id`, not `type`, so template conformance is not implicated.

---

## 5. Why the casing is the way it is

Three sound local decisions producing one unsound global one:

1. **Puck is case-sensitive, PascalCase.** Upstream library convention, not ours
   to change.
2. **CSS document paths are case-insensitive.** Correct for page URLs;
   `normalizePath` lowercases unconditionally.
3. **The registry was modeled as documents** under a reserved `_registry/`
   prefix — which buys branching, copy-on-write, versioning, and auth scoping
   for free. It also inherits (2), which is wrong for component names.

`registryComponentKey` was then introduced on both sides — client-side first
(the `syncComponentRegistry.ts:50` comment cites
`puck-css-integration#122`), then mirrored server-side in
`p1-content-validator/src/registry.ts:13` — as a **compatibility shim** so
lookups survive (2).

The shim solved the loud symptom (re-registration loops) and created a quiet
one: making every lookup case-blind converted "unknown component type — rejected"
into "recognized, accepted, unrenderable." **PCC-3561 is the shim's shadow, not
a missing feature.**

Notably, the original design docs never considered this. Grepping
`docs/puck/plans/2026-04-03-component-registry.md` (2,533 lines) for
case/pascal/normaliz returns only `switch`/`case` statements. The path-lowercasing
collision was never designed for — it was discovered in production and patched
twice.

---

## 6. Full gap inventory

| # | Gap | Location |
|---|---|---|
| 1 | Case-insensitive schema lookup with no canonicalization of `comp.type` — **primary defect** | `validator.ts:136`, `:244` |
| 2 | Backend never validates component types (dependency declared, never imported) | `collaborative-state/package.json:45` |
| 3 | Empty registry → all validation skipped; a fresh site accepts anything | `validator.ts:335` |
| 4 | Validation wrapped in error-swallowing `try/catch`; failure is invisible | `tools.ts:1395-1409`, `:1702-1723` |
| 5 | Path-derived lowercase name advertised to agents when a descriptor fetch fails | `tools.ts:1593`, `:1620`; `registry.ts:139` |
| 6 | Caller-supplied casing baked into the durable `props.id` | `component-identity.ts:111` |
| 7 | Case-insensitive name collisions warned, not blocked — two components share one doc, last write wins | `syncComponentRegistry.ts:105` |
| 8 | No unknown-component guard in editor or renderer — failure is a crash, not a diagnosable placeholder | repo-wide (absent) |
| 9 | e2e mock server doesn't lowercase paths or model `_registry/` — this bug class is **unreproducible in e2e** | `e2e/mock-p1-server.ts` |
| 10 | Two MCP implementations with divergent validation wiring; p1-agent has no enable gate and hand-builds its registry keyed by raw `comp.name` | `p1-agent/src/tools.ts:64`, `:243` |
| 11 | Casing never addressed in the design docs | `docs/puck/plans/2026-04-03-*` |

---

## 7. What actually ends this class of bug

**Principle: the descriptor's `name` is the sole source of truth for
component-type casing. Every boundary that accepts a `type` must rewrite it to
that canonical form or reject it. Matching is not enough.**

Layered, in dependency order:

1. **Canonicalize or reject in `validateOps`.** When
   `registry[registryComponentKey(comp.type)]` hits but
   `comp.type !== schema.name`, either reject with `unknown_component_type`
   naming the exact expected casing, or rewrite to `schema.name`.
   *Recommendation: reject for agent surfaces* — it satisfies the ticket's
   stated expected behavior, teaches the agent the right name, and keeps writes
   honest. Expose a separate `canonicalizeOps` helper for repair tooling on
   already-corrupted documents.
2. **Enforce server-side.** Import the validator into `collaborative-state`'s
   content-write path so no client can bypass it. This is the load-bearing
   "never again" step — everything in the agent processes is advisory, and
   there are already two agent implementations that must not drift.
3. **Kill the lowercase leak.** Drop the path-derived fallback name in
   `list_components` / `fetchRegistry`. A descriptor with no body `name` is
   corrupt: skip it and log, don't advertise a lowercase guess as a valid type.
4. **Remove the root cause.** Exempt `_registry/components/` (and
   `_registry/index`) from `normalizePath`'s lowercasing — scoped there, never to
   `_registry/` as a whole, per §1a. Then rename the existing component documents
   and delete the path-matching shim. This is the only step that removes the
   ambiguity rather than compensating for it. Staged in §9, which is also where
   the two things this description gets wrong if taken literally are corrected:
   the exemption needs no per-call-site change, and only one of the two
   `registryComponentKey` uses is deletable.
5. **Make collisions a hard error** (gap 7). Largely subsumed by (4): Puck config
   keys are JS object keys, so `Foo` and `foo` can legitimately coexist in one
   config, and case-sensitive paths make them two documents instead of one shared
   document with last-write-wins.
6. **Add a render-time unknown-component placeholder** so a future miss is a
   visible, diagnosable state instead of a thrown `TypeError`. This is also what
   makes a corrupted document repairable through the editor at all — today the
   editor crashes on open, so repair has to go through the API.
7. **Make `e2e/mock-p1-server.ts` lowercase paths like the real server**, so this
   class of bug is reproducible in e2e at all.

**These are stages of one ticket, not a fix plus a follow-up.** PCC-3437 shipped
the enforcement-shaped fix and deferred the root-cause removal to a follow-up
that was never filed — it existed only in a work-log note, which is exactly how
it resurfaced as PCC-3561. Splitting again reproduces that failure mode, and
closing PCC-3561 on step 1 alone would leave the ticket reading as fixed while
the root cause remains.

---

## 8. What this branch implements — stage 1 of 4

Steps 1–3 above. Step 4 is not attempted here because it cannot be: renaming the
existing component documents has to run against already-deployed code from the
path change. That is a deploy-ordering constraint, not a scoping preference — see
§9.

**1. Canonicalize-or-reject (`packages/p1-content-validator`)**

- `validator.ts` — after the case-insensitive lookup resolves a schema, reject
  when `comp.type !== schema.name` with a new `component_type_case_mismatch`
  code whose message names the exact expected casing. Skipped when a
  caller-supplied schema omits `name` (public boundary; no canonical casing to
  enforce).
- Deliberately **not** added to `validatePropPathOp`: the type there comes from
  the stored snapshot, so erroring would make an already-corrupted document
  unrepairable — the very edits that would fix it would be rejected.
- No repair helper ships here. An earlier revision added a
  `canonicalizeComponentTypes` export for rewriting corrupted documents; it was
  removed before merge because it had no caller, and `p1-content-validator` is
  publicly published — an unused export is a semver commitment to a function
  nobody uses. It is also unnecessary for repair: a plain
  `replace content.N` op carrying the correct casing already passes validation,
  which is part of why the case check is kept out of `validatePropPathOp`. If a
  sweep is ever warranted, the helper should ship with it, sized to what the
  sweep actually needs. No sweep is warranted: one customer, who did not hit the
  bug — see §9.

**2. Server-side enforcement (`workers/collaborative-state`)**

- `services/component-type-validation.ts` (new) — pure walker over incoming ops
  returning unknown-type and case-mismatch violations. No DB dependency, so it
  is testable in isolation.
- `services/component-type-registry.ts` (new) — reads canonical names for a
  branch from `_registry/components/*` latest versions via one SQL query
  (`snapshot->>'name'`), 60s TTL cache.
- `routes/realtime-api.ts` — `/edits` rejects with 422 before forwarding to the
  DO. This is the load-bearing change: it holds regardless of which client wrote
  the edit, closing gap #2.

**3. Lowercase-leak removal**

- `snapshotToComponentSchema` now takes only the snapshot and returns
  `ComponentSchema | null`, dropping the path-derived name fallback. Callers
  (`fetchRegistry`, `McpApiClient.fetchRegistrySchemas`,
  `list_components`) skip and log a corrupt descriptor instead of advertising a
  lowercase guess as a usable type.

### Deliberately left open

- **Gap #3 (empty registry → skip all validation)** is unchanged, in both the
  validator and the new backend check. Failing closed would block every agent
  write to a site whose editor has never opened, which is a product decision,
  not a bug fix. Both paths now log when they skip. This is the one remaining
  route by which an unknown type can still land.
- **Registry read failure fails open** in the route, for the same reason: a
  transient database problem must not make every document unwritable.
- Gaps #6 (casing baked into `props.id`), #7 (collisions warned not blocked),
  #8 (no render-time placeholder), #9 (e2e mock doesn't lowercase paths), and
  #10 (two MCP implementations) are untouched.

### Verification

- `p1-content-validator`: 96 tests pass, including a **flipped** assertion —
  `validator.spec.ts` previously asserted that a lowercase type *passes*, which
  is how the bug shipped. That test is now inverted, with the reason recorded
  inline.
- `collaborative-state`: 2,782 tests pass; 10 new for the backend check,
  covering the ticket's exact repro (whole-array replace carrying one mis-cased
  component among good ones).
- `css-mcp-server`: 249 tests pass.
- No new type errors and no new lint errors (verified by diffing tsc output
  against the pristine base — the ~2,929 pre-existing errors in
  `collaborative-state` are the known ones CLAUDE.md documents).
- One pre-existing failure in `workers/p1-agent`
  (`tools.test.ts` → "passes when structure still conforms after the edit")
  fails identically on the clean base and is unrelated.

---
## 9. Sequencing the remaining stages

All four stages belong to PCC-3561. They are separate PRs because stage 3 renames
data that stage 2's code change must already be deployed for.

**No content repair is needed.** An earlier revision of this doc left "how many
documents are corrupted" as an open measurement. It is answered: there is one
customer, they did not hit the bug, and any internal instance is unblocked by
hand. So there is no sweep over document *content*, which is also why the
`canonicalizeComponentTypes` helper described in §8 was dropped rather than
deferred. The stage-3 rename below is a different thing — it renames registry
*document paths*, which exist on every site regardless of whether anyone hit the
bug.

Two corrections to how these stages were described earlier, both of which make
the work smaller than it first looked:

- Stage 4 does **not** remove `registryComponentKey` everywhere. Only the
  path-matching copy goes; the type-lookup one is permanent. Detail below.
- `normalizePath` is the single choke point, so the exemption needs no matching
  change at `document-service.ts:272` or any other call site. All twelve inherit
  it.

### Stage 1 — enforcement (this branch)

Must deploy before stage 3 renames anything: it is what stops a write from
inserting a mis-cased type during the window when some component paths are
lowercase and others are not.

### Stage 2 — stop lowercasing component paths

`document-types.ts:368`. `normalizePath` currently runs: trim → length check →
**lowercase (line 389)** → backslashes to slashes → collapse slashes → strip
leading/trailing slashes.

The lowercasing happens *before* separator normalisation, so a prefix test placed
there would fail to recognise `_registry\components\Foo`. Move the lowercase step
to after slash collapsing and apply it conditionally. The reorder is safe because
the two operations are commutative — `toLowerCase` does not affect separators and
separator handling does not affect case.

Exempt `_registry/components/` and `_registry/index`. **Not** `_registry/` as a
whole: `_registry/redirects/{path}` keys on a visitor-supplied page path and must
keep lowercasing (§1a, PCC-3274).

Deployable on its own, and it orphans nothing. Both sides of the match in
`syncComponentRegistry` already funnel through `registryComponentKey` — the
path-derived name at :94, the descriptor name at :189 — so descriptor
`QuoteBlock` still finds the existing `_registry/components/quoteblock` document,
takes the `existingDoc` branch at :226, and writes a new version to it.
`documents.create` is never reached. New components land at true-cased paths,
existing ones keep lowercase paths, and both resolve. The shim absorbs the mixed
state.

### Stage 3 — rename existing component documents

Thirteen rows per site: eleven components in `puck.config.tsx`, plus `__root__`
and the index. With one customer this is small enough to do by hand; a script is
optional.

- Use `updateDocumentPath` (`document-service.ts:193`) rather than raw SQL — it
  runs `normalizePath` + `validatePath`, so after stage 2 it preserves case.
- Read the true name from `snapshot->>'name'` on the site's main branch. Only the
  `path` column changes; no snapshot is rewritten, and re-running is a no-op.
- `app.documents` is keyed `UNIQUE(site_id, path)` and only `document_versions`
  carries `branch_id`, so path is **site-level**: one rename per component covers
  every branch.

One case needs a rule up front. Path is site-level but `name` comes from a
per-branch snapshot, so if two branches disagree on a component's casing they
share one document and the single path can reflect only one of them. Read from
main and **log** the disagreement rather than picking silently — those are the
gap-7 collisions, and surfacing them is the point.

### Stage 4 — delete the path-matching shim

Delete `registryComponentKey` from
`packages/puck-css/src/editor/utils/syncComponentRegistry.ts` (definition at :61,
call sites at :94, :102, :140, :188, :189, :250, :254). Lines 94 and 140 then key
off true-cased path-derived names and index-hash keys, which finally agree without
help.

Gate it on no lowercase-only component paths remaining. The failure mode is
silent duplicate descriptors, not an error: without the shim, :94 keys
`quoteblock`, :189 asks for `QuoteBlock`, nothing matches, and
`documents.create` mints a second document while the lowercase one lives on and
is still returned by the list query.

**Do not touch the type-lookup uses.** These are a different mechanism that only
shares a name:

| Use | Sites | Fate |
|---|---|---|
| Path matching — descriptor names vs path-derived names | `syncComponentRegistry.ts` (above) | delete here |
| Type lookup — keying schemas, resolving an incoming `type` | `p1-content-validator/registry.ts:161`, `validator.ts:136`, `:277`, `:387`, `css-mcp-server/api-client.ts:1261` | **permanent** |

The lookup group never reads a path; it keys off `schema.name`. It exists so a
mis-cased incoming type can be *found*, which is what lets the error name the
casing the writer should have used. Making it exact would turn a precise
"use `QuoteBlock`" into a bare `unknown_component_type` and undo stage 1.

Worth doing in the same stage, to stop this being rediscovered: **rename the
surviving function.** `registryComponentKey` sounds like it concerns registry
storage, which is what makes it look deletable alongside the path shim;
`componentTypeLookupKey` says it concerns lookup and reads wrong to remove.

`componentNameFromPath` becomes a legitimate name source again once paths carry
case, but should stay diagnostics-only — a descriptor with no `name` is still
corrupt, and reintroducing a path fallback reintroduces gap 5.

### Why now rather than later

Stage 2 is a short reorder plus a prefix test, stage 3 is thirteen renames, stage
4 deletes one function and eight call sites. The rename cost scales linearly with
site count and only grows, so a single customer is the cheapest this will ever
be.

The alternative — ship stage 1 and keep the shim indefinitely — is defensible,
since enforcement contains the bug. Its cost is permanent: every future reader
has to understand why registry lookups are case-blind, and the next person
tidying up an "unnecessary" `toLowerCase` reintroduces this. The comments at both
validator sites now warn against exactly that, which mitigates but does not
remove it. If that path is taken, this doc should record it as a decision,
because an unrecorded deferral is what turned PCC-3437 into PCC-3561.
