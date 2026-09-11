"use client";

import React, { useCallback, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Puck } from "@puckeditor/core";
import {
  P1App,
  createNextConfig,
  useP1Editor,
  useP1Plugins,
  useP1Auth,
  useEditorContext,
  useRemoteDatasourceContext,
  wrapConfigForEditorPreview,
  P1QueryProvider,
  editorPathHref,
  EditorReloadOverlay,
} from "@pantheon-systems/puck-css";
import { DatasourceRegistryProvider, DatasourceDataProvider } from "@pantheon-systems/puck-css/fields";
import { LoadingMessage } from "@pantheon-systems/puck-css/pds";
import { P1NextRouterProvider, editorPagePathFromUrlPath } from "@pantheon-systems/p1-next-sdk";
import { P1ChatbotProvider, useP1Chatbot } from "@pantheon-systems/p1-next-sdk/chatbot";
import { createMediaPlugin } from "@pantheon-systems/p1-media";
import type { Checkpoint } from "@pantheon-systems/puck-css";
import type { ContentRole } from "@pantheon-systems/puck-css";
import { P1_ASSETS } from "../../../../constants/assets";

import "@pantheon-systems/puck-css/styles.css";
import "@pantheon-systems/puck-css/pds/styles.css";

import { P1Lockup } from "../../../../components/p1-lockup";
import styles from "../../../../components/welcome-block.module.css";
import config from "../../../../puck.config";

let p1Config: ReturnType<typeof createNextConfig> | null = null;
let p1ConfigError: string | null = null;

try {
  p1Config = createNextConfig();
} catch (e) {
  p1ConfigError = e instanceof Error ? e.message : String(e);
}

const editorConfig = wrapConfigForEditorPreview(config);

const ROLES: ContentRole[] = ['admin', 'editor', 'junior-editor'];

function P1SignInPage() {
  const { login, isLoading, error } = useP1Auth();

  return (
    <div className={styles.surface}>
      <div className={styles.inner}>
        <P1Lockup />

        <h1 className={styles.heading}>
          Your Collaborative Website Management Workspace.
        </h1>
        <p className={styles.description}>
          Log in to your Pantheon P1 account to edit your P1 powered website.
          If you don&apos;t have yet a Pantheon P1 account, contact us{" "}
          <a href="https://pantheon.io/contact-us" className={styles.link}>here</a>.
        </p>

        <div className={styles.actions}>
          <button
            className={styles.button}
            onClick={() => void login()}
            disabled={isLoading}
          >
            {isLoading ? "Signing in..." : "Continue"}
          </button>
        </div>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

export function EditorClientWrapper() {
  // Rendered from the persistent (editor) layout, so this survives page
  // switches; the edited page is derived from the URL instead of route params.
  const pathname = usePathname();
  const path = editorPagePathFromUrlPath(pathname);
  const [userRole, setUserRole] = useState<ContentRole>('editor');

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
          config={{ ...p1Config, userRole }}
          loginFallback={<P1SignInPage />}
        >
          <P1ChatbotProvider>
            <EditorContent path={path} />
          </P1ChatbotProvider>
        </P1App>
        {process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === 'true' && (
          <RoleSwitcher currentRole={userRole} onRoleChange={setUserRole} />
        )}
      </P1NextRouterProvider>
    </P1QueryProvider>
  );
}

function RoleSwitcher({
  currentRole,
  onRoleChange,
}: {
  currentRole: ContentRole;
  onRoleChange: (role: ContentRole) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        borderRadius: 8,
        padding: "8px 12px",
        fontFamily: "system-ui",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <span style={{ opacity: 0.7 }}>Role:</span>
      <select
        value={currentRole}
        onChange={(e) => onRoleChange(e.target.value as ContentRole)}
        style={{
          background: "rgba(255,255,255,0.15)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.3)",
          borderRadius: 4,
          padding: "2px 6px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </div>
  );
}

function EditorContent({ path }: { path: string }) {
  const router = useRouter();
  const { data: editorCtx } = useEditorContext(path);
  const {
    context: remoteDatasourceContext,
  } = useRemoteDatasourceContext(path, editorCtx?.remoteDatasourceRegistry ?? []);
  const p1Plugins = useP1Plugins(path, config);
  const mediaPlugin = React.useMemo(() => createMediaPlugin({}), []);
  // The agent creates the page it was asked for, so the editor follows it there. Also what
  // keeps later turns aimed at the new page: their context is built from the open document.
  const handlePageCreated = useCallback(
    (createdPath: string) => {
      router.push(editorPathHref(createdPath));
    },
    [router],
  );
  const chatbot = useP1Chatbot({ onPageCreated: handlePageCreated });
  const additionalPlugins = React.useMemo(
    () => [...p1Plugins, mediaPlugin, ...chatbot.plugins],
    [p1Plugins, mediaPlugin, chatbot.plugins],
  );

  const [redirecting, setRedirecting] = React.useState(false);

  React.useEffect(() => {
    const returnTo = localStorage.getItem("p1_return_to");
    if (returnTo) {
      localStorage.removeItem("p1_return_to");
      setRedirecting(true);
      router.push(returnTo);
    }
  }, [router]);

  const handleDocumentSelect = useCallback(
    (docPath: string) => {
      router.push(editorPathHref(docPath));
    },
    [router],
  );

  const { loading, reloading, hasContent, error, puckKey, puckProps } = useP1Editor({
    documentPath: path,
    puckConfig: editorConfig,
    additionalPlugins,
    pluginOptions: {
      onDocumentSelect: handleDocumentSelect,
      ...chatbot.pluginOptions,
      selectedDocumentPath: path,
      siteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
      dashboardUrl: process.env.NEXT_PUBLIC_P1_ADMIN_DASHBOARD_URL,
      logoUrl: P1_ASSETS.LOGO_URL,
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
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        <h3>Error loading document</h3>
        <p style={{ color: "#666" }}>{error.message}</p>
      </div>
    );
  }

  return (
    <div className="puck-editor-theme" style={{ position: "relative" }}>
      <EditorReloadOverlay reloading={reloading} />
      <DatasourceRegistryProvider registry={editorCtx?.remoteDatasourceRegistry ?? []}>
        <DatasourceDataProvider context={remoteDatasourceContext}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Puck key={`${puckKey}${chatbot.editorKeySuffix}`} {...puckProps as any} _experimentalFullScreenCanvas={true} />
        </DatasourceDataProvider>
      </DatasourceRegistryProvider>
    </div>
  );
}
