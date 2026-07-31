"use client";

import { useContext, useMemo, type ReactNode } from "react";
import { P1PuckContext, useP1Auth } from "@pantheon-systems/puck-css";
import { MediaConfigProvider, type MediaConfig } from "./context";
import type { MediaPluginOptions } from "./plugin";

/** Production Worker/CDN host — same origin serves both the `/media` API and `/image` delivery. */
const DEFAULT_WORKER_URL = "https://media.p1.pantheon.io";

export type GetAuthToken = () => Promise<string | null> | string | null;

/**
 * Resolves siteId: an explicit value always wins (back-compat for existing
 * callers); otherwise falls back to the ambient puck-css site context. Throws
 * when neither is available — createMediaPlugin() has no error UI of its own,
 * so a clear message here is the only diagnostic a caller gets.
 */
export function resolveSiteId(explicit: string | undefined, contextSiteId: string | undefined): string {
  const siteId = explicit ?? contextSiteId;
  if (!siteId) {
    throw new Error(
      "p1-media: siteId is required. Pass it explicitly to createMediaPlugin(), " +
        "or render the plugin inside a puck-css P1PuckProvider so it can be read from context."
    );
  }
  return siteId;
}

/**
 * Resolves the auth-token getter: an explicit function always wins; otherwise
 * falls back to the ambient puck-css auth context's `getToken`. Throws when
 * neither is available, for the same reason as {@link resolveSiteId}.
 */
export function resolveGetAuthToken(
  explicit: GetAuthToken | undefined,
  contextGetToken: GetAuthToken | undefined
): GetAuthToken {
  const getAuthToken = explicit ?? contextGetToken;
  if (!getAuthToken) {
    throw new Error(
      "p1-media: getAuthToken is required. Pass it explicitly to createMediaPlugin(), " +
        "or render the plugin inside a puck-css P1AuthProvider so it can be read from context."
    );
  }
  return getAuthToken;
}

/**
 * Reads the ambient puck-css site context, if any. `P1PuckContext` is a plain
 * exported React Context (default value `null`), so this never throws —
 * unlike `useP1Puck()`, which throws with no provider.
 */
function useAmbientSiteId(): string | undefined {
  return useContext(P1PuckContext)?.siteId;
}

/**
 * Reads the ambient puck-css auth context's token getter, if any. Unlike
 * `siteId`, puck-css doesn't publicly export a non-throwing read of auth
 * context (`useOptionalP1Auth` exists internally but isn't part of the
 * published package's public API), so this wraps the throwing `useP1Auth()`
 * in a try/catch. That's safe under the rules of hooks: the underlying
 * `useContext` call inside `useP1Auth()` still runs unconditionally every
 * render; only the subsequent plain-JS throw (when there's no provider) is
 * caught here.
 */
function useAmbientGetAuthToken(): GetAuthToken | undefined {
  try {
    return useP1Auth().getToken;
  } catch {
    return undefined;
  }
}

/** Ambient values read from puck-css context — absent when there's no provider. */
export interface AmbientMediaContext {
  siteId?: string;
  getAuthToken?: GetAuthToken;
}

/**
 * Pure assembly of the final {@link MediaConfig} from `options` (explicit
 * args, back-compat) and `ambient` (puck-css context, auto-bind — omit to
 * resolve explicit-only, e.g. from a test that never renders). No hooks, so
 * it's directly unit-testable; `MediaConfigResolver` is the only caller that
 * supplies a real `ambient`, gathered via hooks.
 */
export function buildMediaConfig(options: MediaPluginOptions, ambient: AmbientMediaContext = {}): MediaConfig {
  return {
    workerUrl: options.workerUrl ?? DEFAULT_WORKER_URL,
    siteId: resolveSiteId(options.siteId, ambient.siteId),
    workstreamId: options.workstreamId,
    getAuthToken: resolveGetAuthToken(options.getAuthToken, ambient.getAuthToken),
    metadataFields: options.metadataFields,
  };
}

/**
 * Resolves `options` against the ambient puck-css context and provides the
 * result to `children`. This is the only place in the plugin that reads
 * puck-css context — everything downstream keeps consuming a fully-resolved
 * `MediaConfig` via `useMediaConfig()`, exactly as before.
 *
 * `config` is memoized on `[options, ambientSiteId, ambientGetAuthToken]`,
 * not recomputed on every render: `P1PuckContext`'s value includes the live
 * `currentData` (the document being edited), which changes on nearly every
 * keystroke anywhere in the document. Without memoizing, every mounted media
 * field would get a fresh `config` object identity on every such keystroke,
 * re-firing every `useEffect`/`useCallback` downstream that depends on it
 * (`use-media-schema.ts`, `media-library.tsx`) — including one that clears
 * the media-library search box mid-typing. `ambientGetAuthToken` is already
 * stable across unrelated re-renders (puck-css's `useP1Auth().getToken` is
 * itself a memoized `useCallback`), and `ambientSiteId` is a plain string, so
 * this memoization only recomputes when something that actually matters —
 * the resolved options object, site, or token getter — changes.
 */
export function MediaConfigResolver({
  options,
  children,
}: {
  options: MediaPluginOptions;
  children: ReactNode;
}) {
  const ambientSiteId = useAmbientSiteId();
  const ambientGetAuthToken = useAmbientGetAuthToken();
  const config = useMemo(
    () => buildMediaConfig(options, { siteId: ambientSiteId, getAuthToken: ambientGetAuthToken }),
    [options, ambientSiteId, ambientGetAuthToken]
  );

  return <MediaConfigProvider config={config}>{children}</MediaConfigProvider>;
}
