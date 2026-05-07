"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Puck } from "@puckeditor/core";
import {
  CSSApp,
  createNextConfig,
  useCSSEditor,
  useP1Plugins,
  wrapConfigForEditorPreview,
  P1QueryProvider,
} from "@pantheon-systems/puck-css";
import { P1NextRouterProvider } from "@pantheon-systems/p1-next-sdk";
import type { Checkpoint } from "@pantheon-systems/puck-css";

import "@pantheon-systems/puck-css/styles.css";
import "@pantheon-systems/puck-css/pds/styles.css";

import config from "../../../puck.config";

let cssConfig: ReturnType<typeof createNextConfig> | null = null;
let cssConfigError: string | null = null;

try {
  cssConfig = createNextConfig();
} catch (e) {
  cssConfigError = e instanceof Error ? e.message : String(e);
}

const editorConfig = wrapConfigForEditorPreview(config);

export function EditorClientWrapper({ path }: { path: string }) {
  if (!cssConfig) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        <h3>Editor unavailable</h3>
        <p style={{ color: "#666" }}>
          {cssConfigError ?? "CSS configuration is missing."}
        </p>
        <p style={{ color: "#888", fontSize: "14px" }}>
          Set NEXT_PUBLIC_CSS_BASE_URL and NEXT_PUBLIC_CSS_SITE_ID environment
          variables to enable the editor.
        </p>
      </div>
    );
  }

  return (
    <P1QueryProvider>
      <P1NextRouterProvider>
        <CSSApp
          config={cssConfig}
          loginPageProps={{ title: "P1 Starter", subtitle: "Sign in to edit" }}
        >
          <EditorContent path={path} />
        </CSSApp>
      </P1NextRouterProvider>
    </P1QueryProvider>
  );
}

function EditorContent({ path }: { path: string }) {
  const router = useRouter();
  const p1Plugins = useP1Plugins(path, config);

  const handleDocumentSelect = useCallback(
    (docPath: string) => {
      router.push(`/p1/${docPath}`);
    },
    [router],
  );

  const { loading, error, puckKey, puckProps } = useCSSEditor({
    documentPath: path,
    puckConfig: editorConfig,
    additionalPlugins: p1Plugins,
    pluginOptions: {
      onDocumentSelect: handleDocumentSelect,
      selectedDocumentPath: path,
    },
    overrideOptions: {
      showDefaultPublish: false,
      onPublishSuccess: (checkpoint: Checkpoint) => {
        alert(`Published: ${checkpoint.name ?? checkpoint.id}`);
      },
      onPublishError: (err: Error) => {
        alert(`Publish failed: ${err.message}`);
      },
    },
  });

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        Loading editor...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        <h3>Error loading document</h3>
        <p style={{ color: "#666" }}>{error.message}</p>
      </div>
    );
  }

  return (
    <div className="puck-editor-theme">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Puck key={puckKey} {...puckProps as any} />
    </div>
  );
}
