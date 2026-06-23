"use client";

import React, { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Puck } from "@puckeditor/core";
import {
  P1App,
  createNextConfig,
  useP1Editor,
  useP1Plugins,
  wrapConfigForEditorPreview,
  P1QueryProvider,
} from "@pantheon-systems/puck-css";
import { P1NextRouterProvider } from "@pantheon-systems/p1-next-sdk";
import type { Checkpoint } from "@pantheon-systems/puck-css";

import "@pantheon-systems/puck-css/styles.css";
import "@pantheon-systems/puck-css/pds/styles.css";

import config from "../../../puck.config";

let p1Config: ReturnType<typeof createNextConfig> | null = null;
let p1ConfigError: string | null = null;

try {
  p1Config = createNextConfig();
} catch (e) {
  p1ConfigError = e instanceof Error ? e.message : String(e);
}

const editorConfig = wrapConfigForEditorPreview(config);

export function EditorClientWrapper({ path }: { path: string }) {
  // Keep ref at this level - EditorClientWrapper doesn't unmount on branch switch
  const lastGoodStateRef = React.useRef<{ puckKey: string; puckProps: any } | null>(null);

  if (!p1Config) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        <h3>Editor unavailable</h3>
        <p style={{ color: "#666" }}>
          {p1ConfigError ?? "P1 configuration is missing."}
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
        <P1App
          config={p1Config}
          loginPageProps={{ title: "P1 Starter", subtitle: "Sign in to edit" }}
        >
          <EditorContent path={path} lastGoodStateRef={lastGoodStateRef} />
        </P1App>
      </P1NextRouterProvider>
    </P1QueryProvider>
  );
}

function EditorContent({
  path,
  lastGoodStateRef,
}: {
  path: string;
  lastGoodStateRef: React.MutableRefObject<{ puckKey: string; puckProps: any } | null>;
}) {
  const router = useRouter();
  const p1Plugins = useP1Plugins(path, config);

  const handleDocumentSelect = useCallback(
    (docPath: string) => {
      router.push(`/p1/${docPath}`);
    },
    [router],
  );

  const { loading, error, puckKey, puckProps } = useP1Editor({
    documentPath: path,
    puckConfig: editorConfig,
    additionalPlugins: p1Plugins,
    pluginOptions: {
      onDocumentSelect: handleDocumentSelect,
      selectedDocumentPath: path,
      siteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
      dashboardUrl: process.env.NEXT_PUBLIC_P1_ADMIN_DASHBOARD_URL,
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

  // Update last good state when loading completes successfully (ref passed from parent)
  React.useEffect(() => {
    if (!loading && !error) {
      lastGoodStateRef.current = { puckKey, puckProps };
    }
  }, [loading, error, puckKey, puckProps]);

  // Show full loading screen only on first load (no previous state)
  if (loading && !lastGoodStateRef.current) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        Loading editor...
      </div>
    );
  }

  // Show error only if we have no previous state to fall back to
  if (error && !lastGoodStateRef.current) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        <h3>Error loading document</h3>
        <p style={{ color: "#666" }}>{error.message}</p>
      </div>
    );
  }

  // Use current state if loaded, otherwise keep showing last good state
  const displayState = (!loading && !error)
    ? { puckKey, puckProps }
    : lastGoodStateRef.current ?? { puckKey, puckProps };

  return (
    <div className="puck-editor-theme" style={{ position: "relative" }}>
      {/* Loading overlay - shown during branch switch */}
      {loading && lastGoodStateRef.current && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 9999,
            background: "rgba(255, 255, 255, 0.95)",
            padding: "1rem 2rem",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
            fontFamily: "system-ui",
            fontSize: "14px",
            color: "#333",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              width: "16px",
              height: "16px",
              border: "2px solid #e0e0e0",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              animation: "spin 0.6s linear infinite",
            }}
          />
          Switching workstream...
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Puck key={displayState.puckKey} {...displayState.puckProps as any} _experimentalFullScreenCanvas={true} />
    </div>
  );
}
