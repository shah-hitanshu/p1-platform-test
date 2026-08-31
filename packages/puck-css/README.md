# @pantheon-systems/puck-css

React editor SDK that connects the [Puck](https://puckeditor.com) visual page builder to
Pantheon's P1 content platform — real-time multiplayer editing, versioning,
remote datasources, and a Pantheon-styled inspector.

> Part of Pantheon's **P1** platform. It is published publicly so P1 applications can install
> it, but it is built against Pantheon-hosted services and is not a general-purpose Puck
> add-on. Pre-1.0: minor versions may carry breaking changes.

## Install

```bash
npm install @pantheon-systems/puck-css
```

Peer dependencies you must install alongside it:

```bash
npm install @puckeditor/core @tanstack/react-query react react-dom \
            @pantheon-systems/pds-toolkit-react
```

Most applications consume this through
[`@pantheon-systems/p1-next-sdk`](https://www.npmjs.com/package/@pantheon-systems/p1-next-sdk),
which wires the routes, handlers, and providers for Next.js. Reach for `puck-css` directly when
you are building the editor surface yourself.

## Usage

`useP1Editor` is the primary entry point. It loads the document, joins the collaborative
session, and returns props to spread onto Puck:

```tsx
"use client";

import { useP1Editor } from "@pantheon-systems/puck-css";
import { Puck } from "@puckeditor/core";
import config from "./puck.config";

export function Editor({ path }: { path: string }) {
  const { loading, error, puckKey, puckProps } = useP1Editor({
    documentPath: path,
    puckConfig: config,
  });

  if (loading) return <p>Loading…</p>;
  if (error) return <p>{error.message}</p>;

  return <Puck key={puckKey} {...puckProps} />;
}
```

It must render inside the P1 providers (`P1PuckProvider` and a react-query provider); the
Next.js SDK sets these up for you.

Stylesheets are shipped separately and need importing once:

```ts
import "@pantheon-systems/puck-css/styles.css";
import "@pantheon-systems/puck-css/pds/styles.css";
```

## Entry points

| Import | Contents |
| --- | --- |
| `@pantheon-systems/puck-css` | `useP1Editor`, providers, editor hooks and components |
| `.../config` | Puck config helpers |
| `.../fields` | Field builders, including richtext and inline text |
| `.../connectable` | `Connectable` HOC for datasource-driven blocks |
| `.../routes` | Route and page-path helpers |
| `.../utils/path` | Document path normalization |
| `.../server` | Server-side helpers (Node runtime) |
| `.../registry-sync` | Component registry sync used by CI and the editor |
| `.../auth-gate` | Auth gating for editor routes |
| `.../pds` | Pantheon Design System wrappers |
| `.../styles.css`, `.../pds/styles.css` | Required stylesheets |

## Documentation

Guides and API detail live with the P1 platform documentation. This README covers installation
and the primary entry point only.

## License

MIT
