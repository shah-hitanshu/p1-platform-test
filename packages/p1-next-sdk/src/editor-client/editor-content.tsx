"use client";

import React, { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  editorPathHref,
  useEditorContext,
  useP1Editor,
  useP1Plugins,
  useRemoteDatasourceContext,
} from "@pantheon-systems/puck-css";

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
