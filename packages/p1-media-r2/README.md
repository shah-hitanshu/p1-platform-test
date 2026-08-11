# @pantheon-systems/p1-media

Media library plugin for the P1 Puck editor, backed by Cloudflare R2. Adds asset upload and
browsing to the editor, plus render helpers and a ready-made media figure block.

> Part of Pantheon's **P1** platform. It is published publicly so P1 applications can install
> it, but it requires the Pantheon-hosted media Worker and is not a general-purpose Puck
> plugin. Pre-1.0: minor versions may carry breaking changes.

## Install

```bash
npm install @pantheon-systems/p1-media
```

Peer dependencies:

```bash
npm install @pantheon-systems/puck-css @puckeditor/core react
```

## Usage

Add the plugin to the editor:

```tsx
import { createMediaPlugin } from "@pantheon-systems/p1-media";

const mediaPlugin = createMediaPlugin({
  workerUrl: process.env.NEXT_PUBLIC_MEDIA_WORKER_URL,
});
```

`siteId` defaults to the ambient `P1PuckProvider` site context — pass it explicitly only when
rendering outside that provider, or to override it. `workerUrl` defaults to the production
media host.

Render uploaded media with the provided components, which handle R2 image transformation URLs:

```tsx
import { MediaImage, MediaFigure, buildImageUrl } from "@pantheon-systems/p1-media";
```

`createMediaFigureBlock` builds a drop-in Puck block for captioned media.

## Entry points

| Import | Contents |
| --- | --- |
| `@pantheon-systems/p1-media` | Plugin, render components, media value helpers |
| `.../server` | Server-side helpers |

## Note on the package name

The source directory is `packages/p1-media-r2/`, but the package publishes as
`@pantheon-systems/p1-media`.
