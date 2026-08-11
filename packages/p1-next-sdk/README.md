# @pantheon-systems/p1-next-sdk

Next.js SDK for the P1 editor. Mounts the editor, its API routes, auth, and published-page
rendering into a Next.js App Router application with a handful of factories.

> Part of Pantheon's **P1** platform. It is published publicly so P1 applications can install
> it, but it talks to Pantheon-hosted services and is not a general-purpose Next.js library.
> Pre-1.0: minor versions may carry breaking changes.

## Install

```bash
npm install @pantheon-systems/p1-next-sdk
```

Peer dependencies:

```bash
npm install @puckeditor/core next react react-dom
```

The fastest way to get a working application is to scaffold one:

```bash
npm create @pantheon-systems/p1-starter-kit my-app
```

## Usage

Mount the API routes in `app/p1/api/[...p1]/route.ts`:

```ts
import { createP1Handler } from "@pantheon-systems/p1-next-sdk/server";
import config from "../../../../puck.config";

const handler = createP1Handler({
  config,
  p1BaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL,
  p1ApiKey: process.env.CSS_API_KEY,
  p1SiteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
});

export const { GET, POST } = handler;
```

And the editor and dashboard pages:

```ts
import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";
import config from "../../../../puck.config";

export const pages = createP1Pages({
  config,
  p1BaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL,
  p1ApiKey: process.env.CSS_API_KEY,
  p1SiteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
});
```

Client components render inside `P1NextRouterProvider`, which bridges P1 navigation to the
Next.js router.

## Entry points

| Import | Contents |
| --- | --- |
| `@pantheon-systems/p1-next-sdk` | `P1NextRouterProvider` and client-side helpers |
| `.../server` | `createP1Handler`, `createP1AuthHandler`, `createP1Pages`, `createP1Middleware`, `createCssQueryFetchers` |

Transpilation is required, since the P1 packages ship untranspiled ESM:

```js
// next.config.mjs
transpilePackages: [
  "@pantheon-systems/css-client",
  "@pantheon-systems/puck-css",
  "@pantheon-systems/p1-next-sdk",
],
```

## CLI

The package ships a `p1-migrate` binary for applying P1 migrations:

```bash
npx p1-migrate
```
