"use client";

import React, { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  editorPathHref,
  useEditorContext,
  useP1Auth,
  useP1Editor,
  useP1Plugins,
  useRemoteDatasourceContext,
} from "@pantheon-systems/puck-css";

import { useP1ExperimentalFeatures } from "../experimental-features";
import { p1UserFlagKey } from "../launchdarkly/user-key";
import { EditorCanvas } from "./editor-canvas";
import { useReturnToRedirect } from "./return-to";
import type { EditorRuntime } from "./runtime";
import type { P1EditorContext } from "./types";

/**
 * Everything that depends on which document is open: loading it, assembling the
 * plugin set, navigating between documents, and claiming a post-login redirect.
 */
export function EditorContent({
  runtime,
  path,
}: {
  runtime: EditorRuntime;
  path: string;
}) {
  const router = useRouter();
  const { data: editorCtx } = useEditorContext(path);
  const datasourceRegistry = editorCtx?.remoteDatasourceRegistry ?? [];
  const { context: datasourceContext } = useRemoteDatasourceContext(
    path,
    datasourceRegistry,
  );
  const p1Plugins = useP1Plugins(path, runtime.puckConfig);

  // Which experimental features this person has on this site. Resolved here rather
  // than per app so a feature reaches every P1 editor as a flag change, and so an app
  // cannot leave a half-built one reachable.
  const { user } = useP1Auth();
  const features = useP1ExperimentalFeatures({
    userId: p1UserFlagKey(user),
    siteId: runtime.config?.siteId,
  });

  const openDocument = useCallback(
    (documentPath: string) => {
      router.push(editorPathHref(documentPath));
    },
    [router],
  );

  const ctx = useMemo<P1EditorContext>(
    () => ({ path, openDocument }),
    [path, openDocument],
  );

  const extensions = runtime.useExtensions(ctx);

  const additionalPlugins = useMemo(
    () => [...p1Plugins, ...runtime.plugins, ...(extensions.plugins ?? [])],
    [p1Plugins, runtime.plugins, extensions.plugins],
  );

  const redirecting = useReturnToRedirect(router);

  const { loading, reloading, hasContent, error, puckKey, puckProps } = useP1Editor({
    documentPath: path,
    puckConfig: runtime.editorConfig,
    additionalPlugins,
    pluginOptions: {
      onDocumentSelect: openDocument,
      selectedDocumentPath: path,
      siteId: runtime.config?.siteId,
      dashboardUrl: process.env.NEXT_PUBLIC_P1_ADMIN_DASHBOARD_URL,
      ...runtime.pluginOptions,
      ...extensions.pluginOptions,
    },
    overrideOptions: {
      showDefaultPublish: false,
      ...runtime.overrideOptions,
      ...extensions.overrideOptions,
      // Last, because availability is Pantheon's to decide: an application cannot turn
      // an unfinished feature on for itself.
      threadsEnabled: features.isEnabled("threads"),
    },
  });

  return (
    <EditorCanvas
      redirecting={redirecting}
      loading={loading}
      reloading={reloading}
      error={error}
      hasContent={hasContent}
      canvasKey={`${puckKey}${extensions.editorKeySuffix ?? ""}`}
      puckProps={puckProps}
      datasourceRegistry={datasourceRegistry}
      datasourceContext={datasourceContext}
    />
  );
}
