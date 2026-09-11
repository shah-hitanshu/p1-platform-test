"use client";

import React from "react";
import { Puck } from "@puckeditor/core";
import { EditorReloadOverlay } from "@pantheon-systems/puck-css";
import type { PuckProps, ReloadKind } from "@pantheon-systems/puck-css";
import {
  DatasourceRegistryProvider,
  DatasourceDataProvider,
} from "@pantheon-systems/puck-css/fields";
import { LoadingMessage } from "@pantheon-systems/puck-css/pds";

import { EditorMessage } from "./editor-message";
import styles from "./editor-canvas.module.css";

type DatasourceRegistry = React.ComponentProps<typeof DatasourceRegistryProvider>["registry"];
type DatasourceContext = React.ComponentProps<typeof DatasourceDataProvider>["context"];

/**
 * What the editor route shows: a loading or error state, or the Puck canvas
 * inside the remote-datasource providers it reads fields through.
 */
export function EditorCanvas({
  redirecting,
  loading,
  reloading,
  error,
  hasContent,
  canvasKey,
  puckProps,
  datasourceRegistry,
  datasourceContext,
}: {
  redirecting: boolean;
  loading: boolean;
  reloading: ReloadKind | null;
  error: Error | null;
  hasContent: boolean;
  canvasKey: string;
  puckProps: PuckProps;
  datasourceRegistry: DatasourceRegistry;
  datasourceContext: DatasourceContext;
}) {
  if (redirecting) {
    return <LoadingMessage message="Redirecting" data-testid="editor-redirecting" />;
  }

  if (loading) {
    return <LoadingMessage message="Loading document" data-testid="editor-loading" />;
  }

  // A failed load with a document already on screen keeps that document; only a
  // failure with nothing to fall back on takes over the view.
  if (error && !hasContent) {
    return (
      <EditorMessage
        testId="editor-error"
        title="Error loading document"
        detail={error.message}
      />
    );
  }

  return (
    <div className={`puck-editor-theme ${styles.canvas}`}>
      <EditorReloadOverlay reloading={reloading} />
      <DatasourceRegistryProvider registry={datasourceRegistry}>
        <DatasourceDataProvider context={datasourceContext}>
          <Puck
            key={canvasKey}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...(puckProps as any)}
            _experimentalFullScreenCanvas={true}
          />
        </DatasourceDataProvider>
      </DatasourceRegistryProvider>
    </div>
  );
}
