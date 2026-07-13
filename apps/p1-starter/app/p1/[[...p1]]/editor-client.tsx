"use client";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Puck } from "@puckeditor/core";
import {
  P1App,
  createNextConfig,
  useP1Editor,
  useP1Plugins,
  useP1Auth,
  wrapConfigForEditorPreview,
  P1QueryProvider,
  editorPathHref,
} from "@pantheon-systems/puck-css";
import { P1NextRouterProvider } from "@pantheon-systems/p1-next-sdk";
import type { Checkpoint } from "@pantheon-systems/puck-css";
import type { ContentRole } from "@pantheon-systems/puck-css";
import { P1_ASSETS } from "../../../constants/assets";

import "@pantheon-systems/puck-css/styles.css";
import "@pantheon-systems/puck-css/pds/styles.css";

import { P1Lockup } from "../../../components/p1-lockup";
import config from "../../../puck.config";

const DEFAULT_PAGE_DATA = {
  root: { props: { title: "New page" } },
  content: [],
  zones: {},
};

const DEFAULT_ROOT_PAGE_DATA = {
  root: { props: { title: "Welcome | P1 site" } },
  content: [
    {
      type: "P1WelcomeBlock",
      props: {
        id: "seed-welcome",
        heading: "Welcome to your new Pantheon P1 Site.",
        description: "You just created this new site from Pantheon P1 starter kit, congrats! You'll need a Pantheon P1 user account to edit it and create new pages.",
        ctaLabel: "Sign-in to P1",
        ctaHref: "/p1",
        footnote: "Visit [P1 documentation](https://docs.pantheon.io) for more information.",
        loggedInHeading: "Welcome to your new Pantheon P1 Site.",
        loggedInDescription: "You just created this new site from Pantheon P1 starter kit, congrats! Start editing this page or visit the P1 dashboard to manage your site.",
        loggedInCtaLabel: "Edit this page with P1 Visual Editor",
        loggedInCtaHref: "/p1",
        loggedInSecondaryLabel: "Go to P1 Dashboard",
        loggedInFootnote: "Visit [P1 documentation](https://docs.pantheon.io) for more information.",
        showLogo: true,
      },
    },
  ],
  zones: {},
};

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
    <div className="w-full max-w-[620px] mx-auto flex flex-col items-center text-center px-8 py-16 font-['Inter',system-ui,sans-serif] text-[#1a1a2e] min-h-screen justify-center">
      <P1Lockup />

      <h1 className="text-[2.5rem] leading-[1.08] font-semibold m-0 mb-3" style={{ fontSize: '2.5rem' }}>
        Your Collaborative Website Management Workspace.
      </h1>
      <p className="text-base leading-6 text-[#5a5a6e] max-w-[54ch] m-0">
        Log in to your Pantheon P1 account to edit your P1 powered website.
        If you don&apos;t have yet a Pantheon P1 account, contact us{" "}
        <a href="https://pantheon.io/contact-us" className="text-blue-600 underline">here</a>.
      </p>

      <div className="flex gap-3 mt-8 justify-center">
        <button
          className="inline-flex items-center justify-center h-12 px-6 gap-2 rounded-full border border-[#1a1a2e] bg-[#1a1a2e] text-white font-['Inter',system-ui,sans-serif] text-lg font-medium leading-none whitespace-nowrap cursor-pointer transition-colors duration-200 hover:bg-[#2d2d44] hover:border-[#2d2d44] focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-600 focus-visible:outline-offset-1 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => void login()}
          disabled={isLoading}
        >
          {isLoading ? "Signing in..." : "Continue"}
        </button>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
          {error}
        </p>
      )}
    </div>
  );
}

export function EditorClientWrapper({ path }: { path: string }) {
  const [userRole, setUserRole] = useState<ContentRole>('editor');
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
          config={{ ...p1Config, userRole }}
          loginFallback={<P1SignInPage />}
        >
          <EditorContent path={path} lastGoodStateRef={lastGoodStateRef} />
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

function EditorContent({
  path,
  lastGoodStateRef,
}: {
  path: string;
  lastGoodStateRef: React.MutableRefObject<{ puckKey: string; puckProps: any } | null>;
}) {
  const router = useRouter();
  const { getToken } = useP1Auth();
  const p1Plugins = useP1Plugins(path, config);

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

  const handleDocumentNotFound = useCallback(
    async (docPath: string, _error: Error) => {
      const initialData = docPath === "/" ? DEFAULT_ROOT_PAGE_DATA : DEFAULT_PAGE_DATA;
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/p1/api/structure/page", {
        method: "POST",
        headers,
        body: JSON.stringify({ path: docPath, initialData }),
      });
      return res.ok;
    },
    [getToken],
  );

  const { loading, error, puckKey, puckProps } = useP1Editor({
    documentPath: path,
    puckConfig: editorConfig,
    additionalPlugins: p1Plugins,
    onDocumentNotFound: handleDocumentNotFound,
    pluginOptions: {
      onDocumentSelect: handleDocumentSelect,
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

  // Update last good state when loading completes successfully (ref passed from parent)
  React.useEffect(() => {
    if (!loading && !error) {
      lastGoodStateRef.current = { puckKey, puckProps };
    }
  }, [loading, error, puckKey, puckProps]);

  if (redirecting) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", fontFamily: "system-ui" }}>
        Redirecting...
      </div>
    );
  }

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
