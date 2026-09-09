# ccr-mcp-server

The MCP server that exposes CCR content operations to MCP clients. Every tool it
advertises lives in `src/tools/<domain>/`, one file per tool.

Commands: `pnpm test | lint | typecheck` (and `pnpm dev` for `wrangler dev`).

## Adding a tool

A tool is **one record in one file**. Schema, description, annotations,
rate-limit class and handler sit together — there is no second list to update
anywhere.

```ts
// src/tools/<domain>/do-the-thing.ts
import z from 'zod';
import { defineTool } from '../types/define-tools.functions.js';
import { formatError, formatResult } from '../types/format-mcp-responses.functions.js';

const DoTheThingInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
});

export const doTheThingTool = defineTool({
  description: 'What this does, when to reach for it, and what it returns.',
  inputSchema: DoTheThingInputSchema,
  annotations: { title: 'Do the thing', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      return formatResult(await ctx.apiClient.doTheThing(input.site_id));
    } catch (error) {
      return formatError(error);
    }
  },
});
```

Then register it in the domain's `index.ts`, keyed by the name clients call:

```ts
export const domainTools = defineTools({
  do_the_thing: doTheThingTool,
});
```

That is the whole change. `src/tools/index.ts` spreads every domain into
`allTools`, and derives `schemas` and `mutationTools` from it;
`mcp-handler.ts` registers whatever is in `allTools`. Nothing else needs editing.

New domain? Add the folder with an `index.ts` exporting a `defineTools({...})`
map and spread it into `allTools`.

### Use `defineTool`, never annotate with `P1McpTool` directly

`defineTool` is an identity function that exists to infer the schema generic, so
`handler`'s `input` is typed from `inputSchema`. Writing
`const t: P1McpTool = {...}` collapses the generic to its default and silently
types `input` as `any`.

### The handler contract

Handlers get `(ctx, input)` — see `P1McpToolContext`:

- `ctx.apiClient` — the CCR client. `ctx.apiClient.validationEnabled` gates
  registry/template validation (off in tests, on in production).
- `ctx.trigger` / `ctx.requestedById` — actor attribution. Pass both to any
  `apiClient` call that takes them, so an edit made on a human's behalf is
  recorded as `human_requested` rather than `autonomous`.
- `ctx.actingUser` — present only on the OAuth path, absent for agent API keys.

Return `formatResult(...)` or `formatError(...)`. Catch errors inside the
handler and return `formatError` — a thrown error surfaces to the client without
the `isError` shape.

### `mutates` is the rate limiter

`mutates: true` puts the tool on the tighter mutation limiter, `false` on the
read limiter. It is a required field so a new tool has to make the choice, and
it is now the *only* thing selecting the limiter — the old hand-maintained
`MUTATION_TOOLS` set in `mcp-handler.ts` is gone.

It tracks "does this write to the backend", not "is this a POST". `check_merge`
and `preview_merge` are POSTs that change nothing, so they are `false`.

### Descriptions are product surface, and nothing tests them

The `description` and every `.describe()` on a field are what an LLM reads to
decide whether and how to call the tool. No test asserts on them. Treat a
wording change as a behaviour change: say what the tool does, when to use it,
what identifiers it needs and where those come from, and whether it is
destructive enough to confirm with the user first.

When moving a tool, copy its description verbatim rather than retyping it.

#### Say "workstream", never "branch"

The dashboard calls an isolated line of work a **workstream**, so every string a
user can end up reading says workstream: `description`, every `.describe()`,
`annotations.title`, and any prose in a `formatResult`. The wire contract keeps
the older spelling — tool names (`list_branches`), parameter keys (`branch_id`,
`source_branch_id`) and response keys (`branchId`) are unchanged, and
`SERVER_INSTRUCTIONS` in `mcp-handler.ts` tells the client the two name the same
thing.

`tests/shared/terminology.spec.ts` enforces this across three surfaces: the tool
`description`, every `.describe()` in the schema (recursing through arrays,
wrappers and nested objects, so `ConflictResolutionSchema.strategy` is covered),
and the prose a handler actually returns — it runs every handler against an
empty and a populated backend. What it deliberately does **not** check is
backend data passed through a `formatResult`: wire keys like `branchId`, and
values such as a workstream a user chose to name "branch", are not ours to
rename. So the handler check reads plain-string results whole and, in a JSON
result, only `message` fields.

### Shared schema fragments

Domains keep a local `shared-schemas.ts` for the shapes their own tools reuse
(`BranchIdInputSchema`, `StructureScopedInputSchema`, …). Deliberately not one
global schema module: field descriptions differ subtly between tools that look
identical, and over-sharing a base rewrites prompt text by accident.

## Testing a tool

`tests/helpers/tool-handlers.ts` builds a by-name handler map from `allTools`,
so a spec never constructs a tool context itself:

```ts
const { createTestHandlers } = await import('../helpers/tool-handlers.js');
const handlers = await createTestHandlers(new McpApiClient(config));
const result = await handlers.do_the_thing({ site_id: 'site-1' });
```

Specs live in `tests/shared/`, roughly one file per domain. Import `schemas` and
`allTools` from `src/tools/index.js` when asserting on registration rather than
reaching into a domain folder.

`pnpm lint` runs eslint over `src` and `tests`; it is slow through turbo, so
`npx eslint src tests` is the faster equivalent while iterating.

## Gotchas

- `getLogger()` before `ensureLogger(env)` returns an unconfigured fallback. In
  request-path tool code this is fine — `index.ts` initialises first.
- Dev port 8788 collides with `workers/p1-media`; don't run both locally.
- `src/shared/api-client.ts` is large and still organised by domain internally;
  it has not been split.
