"use client";

/**
 * Builds the editor client component an app mounts at its P1 editor route.
 *
 * The shell around the Puck canvas — provider nesting, auth gating, document
 * loading, the remote-datasource context, the post-login return redirect, and
 * the loading / error / reload states — is the same for every P1 site. Assembled
 * by hand in each app's route file it froze a copy into every scaffold, so a fix
 * to any of it could never reach a project once that project existed. It lives
 * here instead, and the route file becomes a shim.
 *
 * What genuinely differs per app flows in as options: the app's puck config, its
 * sign-in page, the extra editor plugins it wants, and the publish handling it
 * wants on top of the defaults.
 *
 * Usage:
 *   // app/p1/(editor)/[[...p1]]/editor-client.tsx
 *   "use client";
 *   import { createP1EditorClient } from "@pantheon-systems/p1-next-sdk";
 *   import "@pantheon-systems/p1-next-sdk/editor.css";
 *   import config from "@/puck.config";
 *
 *   export const EditorClientWrapper = createP1EditorClient({
 *     puckConfig: config,
 *     signInPage: <MySignInPage />,
 *   });
 *
 * The stylesheet is imported by the route rather than by this module: it is
 * only wanted where the editor actually mounts, and importing it here would put
 * the editor's CSS on every page that touches this package.
 *
 * The shell itself is three components — `EditorShell` (providers, role, auth),
 * `EditorContent` (the open document) and `EditorCanvas` (what is on screen) —
 * each reading its inputs from the `EditorRuntime` this factory builds.
 */

import React from "react";

import { EditorShell } from "./editor-shell";
import { createEditorRuntime } from "./runtime";
import type { CreateP1EditorClientOptions } from "./types";

export function createP1EditorClient(options: CreateP1EditorClientOptions) {
  const runtime = createEditorRuntime(options);

  return function P1EditorClient() {
    return <EditorShell runtime={runtime} />;
  };
}
