# @pantheon-systems/p1-feature-flags

Internal, unpublished. Boolean feature flags for the workers, resolved through LaunchDarkly's
Cloudflare SDK.

Evaluation is an in-memory read, not an outbound call: LaunchDarkly's Cloudflare integration
syncs the whole flag payload into a KV namespace, the SDK reads that once per isolate and
caches it, and `variationDetail` evaluates locally. Nothing in a request path talks to
LaunchDarkly.

## Using it

Every flag lives in `src/p1-feature-flags.ts` — `P1_FLAG_KEYS`, every key this platform reads in
either runtime, and a `P1_FEATURE_FLAG_CONFIGURATIONS` entry per flag this service resolves. One file
answers what exists, what it falls back to, and what it ramps on, and it is the one place to
delete from when a flag retires:

```ts
export const P1_FEATURE_FLAG_CONFIGURATIONS = {
  mergeJobRunner: {
    key: 'p1-merge-job-runner',
    fallback: false,
    contextKind: 'site',
  },
} as const satisfies Record<string, P1FeatureFlag>;
```

`key` is typed as `P1FlagKey`, which is derived from `P1_FLAG_KEYS`, so a flag cannot be
declared under a key the vocabulary does not carry. That list also covers keys gated outside
this service — `p1-chatbot` is read by the browser SDK in `apps/p1-starter`, `p1-collaboration`
by `useP1ExperimentalFeatures` in `@pantheon-systems/p1-next-sdk` — because the key is the part
two runtimes have to spell identically. Fallback and context kind are not shared: the same flag
can ramp per site in a worker and per user in the browser.

A browser-gated key is spelled twice, because this package is private and the SDK that reads it
is published, so neither can import the other's catalog. `pnpm check:flag-keys` compares them
and fails on a key that is not in `P1_FLAG_KEYS`; without it a misspelling resolves to off,
which is indistinguishable from a flag that has not been rolled out yet.

Build the isolate's service at request entry, next to `ensureLogger(env)`. Passing `ctx` starts
initialization there rather than on the first gated request:

```ts
P1FeatureFlagService.init(env, ctx);
```

Then read the gate. The second argument is the key to evaluate against, read as the flag's own
`contextKind` — a site id for a `site`-kind flag:

```ts
import {
  P1FeatureFlagService,
  P1_FEATURE_FLAG_CONFIGURATIONS,
} from '@pantheon-systems/p1-feature-flags';

if (
  await P1FeatureFlagService.current().isEnabled(
    P1_FEATURE_FLAG_CONFIGURATIONS.mergeJobRunner,
    siteId,
  )
) {
  // ...
}
```

`init` is idempotent per isolate: the same bindings keep the same LaunchDarkly client, since
rebuilding one throws away the synced payload it has already read. Code holding its own
bindings and no singleton — a Durable Object, a test — constructs `new P1FeatureFlagService(env)`
directly instead. `current()` before any `init` degrades to an unconfigured service that
resolves every flag to its fallback, and says so once.

Resolution order is `FLAG_OVERRIDES`, then LaunchDarkly, then the flag's own fallback. Every
failure — unconfigured lane, unreachable store, a value that isn't a boolean — resolves to the
fallback, so choose a fallback that is safe to serve indefinitely.

## Bindings

| Binding | Kind | Notes |
| --- | --- | --- |
| `LD_KV` | KV namespace | Written by the LD to Cloudflare integration. One per lane, shared by every worker in it — the payload key is derived from the LD environment, not from the worker. |
| `LD_CLIENT_SIDE_ID` | var | Public by design; only used to key into `LD_KV`. Not a secret. |
| `FLAG_OVERRIDES` | var | Optional JSON object of flag key to boolean. |
| `ENVIRONMENT` | var | Already present for the logger. An absent LaunchDarkly is normal in `local` and an error anywhere else. |

A worker whose `compatibility_flags` lack `nodejs_compat` cannot bundle this — the SDK's edge
layer imports `node:events`.

### `FLAG_OVERRIDES`

```jsonc
"FLAG_OVERRIDES": "{\"p1-merge-job-runner\": true}"
```

This is how the local lane and the test suites run with no LD connection, and it is the only
way to move a deployed lane off a bad value while LaunchDarkly is unreachable. Only boolean
members are honoured; a string `"true"` is ignored rather than guessed at.

## Conventions

- **Key naming:** `p1-<area>-<thing>`, matching `p1-chatbot` and `p1-merge-job-runner`.
- **Fallback is the pre-flag behaviour.** A flag gating a new path falls back to `false`; a
  flag gating a kill switch on an old one falls back to `true`.
- **Record an owner and a retirement condition** in the LaunchDarkly dashboard when you create
  the flag. A flag with no retirement condition is a config var with extra steps.
- **Prefer a flag to a wrangler var** for anything you might want to change without a deploy.

### Live flags

| Key | Gates | Fallback | Consumer |
| --- | --- | --- | --- |
| `p1-merge-job-runner` | Merge execution through the job runner, versus the legacy inline path | `false` | `workers/ccr` |
| `p1-chatbot` | The AI chatbot plugin in the editor | `false` | `apps/p1-starter` (browser SDK, not this package) |
| `p1-collaboration` | Comment threads on blocks, pages and other addressable content | `false` | `@pantheon-systems/p1-next-sdk` (browser SDK, not this package) |

## Logging

Resolution logs at `debug` with `flag_key`, `flag_value`, and `flag_source`. Failures log at
`warn` or `error` and add `flag_reason` when LaunchDarkly returned one. All four fields have to
be in the consuming worker's `allowFields` or redaction drops them.

The edge SDK sends no analytics events, so LaunchDarkly's dashboard never shows these flags as
evaluated. These logs are the only evidence that a gate is being read at all — which is why an
`ERROR` evaluation reason (typically `FLAG_NOT_FOUND`, what a flag missing from the synced
payload looks like) gets its own `warn` rather than being folded into the fallback silently.
