# @pantheon-systems/css-client

TypeScript API client for Pantheon's Collaborative Content Repository (CCR) — documents, content,
authentication, and the realtime collaboration channel.

> Part of Pantheon's **P1** platform. It is published publicly so P1 applications can install
> it, but it targets Pantheon-hosted services and has no standalone use. Pre-1.0: minor
> versions may carry breaking changes.

## Install

```bash
npm install @pantheon-systems/css-client
```

No peer dependencies — the package is framework-agnostic and runs in both browser and Node
environments.

## Usage

```ts
import { P1Client } from "@pantheon-systems/css-client";

const client = new P1Client({
  baseUrl: "https://api.example.com", // or http://localhost:8787 in local dev
  apiKey: process.env.CSS_API_KEY,
});
```

`apiKey` authenticates as a Bearer token. For browser sessions where a user logs in, supply a
custom `AuthProvider` instead — it takes precedence over `apiKey` when both are given. Helpers
for the Pantheon login broker (`createBrokerAuth`, `hasPendingBrokerLogin`,
`redeemPendingBrokerLogin`) cover that flow.

Realtime collaboration is a separate client:

```ts
import { RealtimeClient } from "@pantheon-systems/css-client";
```

## Entry points

| Import | Contents |
| --- | --- |
| `@pantheon-systems/css-client` | `P1Client`, `RealtimeClient`, auth and broker helpers |
| `.../content` | `P1ContentClient` and content types |

## License

MIT
