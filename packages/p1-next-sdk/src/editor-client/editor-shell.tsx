"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { P1App, P1QueryProvider } from "@pantheon-systems/puck-css";
import type { ContentRole } from "@pantheon-systems/puck-css";

import { P1NextRouterProvider } from "../P1NextRouterProvider";
import { editorPagePathFromUrlPath } from "../editor-paths";
import { EditorContent } from "./editor-content";
import { EditorMessage } from "./editor-message";
import { RoleSwitcher } from "./role-switcher";
import type { EditorRuntime } from "./runtime";

/**
 * The editor's outermost frame: which document the URL names, the content role
 * the editor renders as, and the providers and auth gate the content sits in.
 */
export function EditorShell({ runtime }: { runtime: EditorRuntime }) {
  // Rendered from the persistent (editor) layout, so this survives page
  // switches; the edited page is derived from the URL instead of route params.
  const pathname = usePathname();
  const path = editorPagePathFromUrlPath(pathname);
  const [userRole, setUserRole] = useState<ContentRole | undefined>(
    runtime.roleSwitcher ? (runtime.initialUserRole ?? 'editor') : runtime.initialUserRole
  );

  if (!runtime.config) {
    return (
      <EditorMessage
        testId="editor-unavailable"
        title="Editor unavailable"
        detail={runtime.configError ?? "P1 configuration is missing."}
        hint="Set NEXT_PUBLIC_CSS_BASE_URL and NEXT_PUBLIC_CSS_SITE_ID environment variables to enable the editor."
      />
    );
  }

  const editor = <EditorContent runtime={runtime} path={path} />;

  return (
    <P1QueryProvider>
      <P1NextRouterProvider>
        <P1App
          config={{ ...runtime.config, userRole }}
          loginFallback={runtime.signInPage}
        >
          {runtime.wrapEditor ? runtime.wrapEditor(editor) : editor}
        </P1App>
        {runtime.roleSwitcher && userRole !== undefined && (
          <RoleSwitcher currentRole={userRole} onRoleChange={setUserRole} />
        )}
      </P1NextRouterProvider>
    </P1QueryProvider>
  );
}
