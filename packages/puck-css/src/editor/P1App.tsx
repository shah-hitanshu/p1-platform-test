import React, { useEffect, useMemo } from 'react';
import { P1Client } from '@pantheon-systems/css-client';
import { GlobalWrapper } from '@pantheon-systems/pds-toolkit-react';
import { LoadingMessage } from '../pds/components/LoadingMessage.js';
import { P1AuthProvider, useP1Auth, P1LoginPage } from '../auth/index.js';
import { PresenceFocusBridge } from '../collaboration/PresenceFocusBridge.js';
import type { P1Config } from '../core/config.js';
import { pdsCoreCSS } from '../pds/theme/pds-core-content.js';
import { P1PuckProvider } from './P1PuckProvider.js';

export interface P1AppProps {
  config: P1Config;
  children: React.ReactNode;
  loadingFallback?: React.ReactNode;
  loginFallback?: React.ReactElement;
  loginPageProps?: { title?: string; subtitle?: string };
}

function AuthGate({
  config,
  children,
  loadingFallback,
  loginFallback,
  loginPageProps,
}: P1AppProps): React.ReactElement {
  const { isAuthenticated, isLoading, user, token } = useP1Auth();

  if (isLoading) {
    return <>{loadingFallback ?? <LoadingMessage message="Authenticating..." data-testid="auth-loading" />}</>;
  }

  if (!isAuthenticated) {
    if (loginFallback) {
      return loginFallback;
    }
    return <P1LoginPage {...loginPageProps} />;
  }

  if (!user || !token) {
    return <>{loadingFallback ?? <LoadingMessage message="Initializing..." data-testid="auth-initializing" />}</>;
  }

  return (
    <AuthenticatedShell config={config} user={user} token={token}>
      {children}
    </AuthenticatedShell>
  );
}

function AuthenticatedShell({
  config,
  user,
  token,
  children,
}: {
  config: P1Config;
  user: { id: string; name: string; email?: string };
  token: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { getToken } = useP1Auth();

  const p1Client = useMemo(
    () =>
      new P1Client({
        baseUrl: config.clientBaseUrl || config.baseUrl,
        authProvider: async () => {
          const t = await getToken();
          if (!t) throw new Error('Session expired — please sign in again');
          return `Bearer ${t}`;
        },
        tokenRefresher: getToken,
      }),
    [config.clientBaseUrl, config.baseUrl, getToken]
  );

  return (
    <P1PuckProvider
      key={user.id}
      client={p1Client}
      siteId={config.siteId}
      branchId={config.branchId}
      userId={user.id}
      userName={user.name}
      autoSaveDelay={config.autoSaveDelay}
      maxRetries={config.maxRetries}
      enableRealtime={config.enableRealtime}
      wsBaseUrl={config.wsBaseUrl}
      realtimeApiKey={token}
      presenceEnabled={config.enablePresence}
      realtimeTokenRefresher={getToken}
    >
      {config.enablePresence ? (
        <PresenceFocusBridge userId={user.id}>{children}</PresenceFocusBridge>
      ) : (
        children
      )}
    </P1PuckProvider>
  );
}

export function P1App({
  config,
  children,
  loadingFallback,
  loginFallback,
  loginPageProps,
}: P1AppProps): React.ReactElement {
  // PDS CANVAS ISOLATION — READ THIS BEFORE MODIFYING
  //
  // pds-core.css contains 1,371 element-level CSS rules (full CSS reset, typography,
  // link colors, etc.) that must NOT reach Puck's canvas iframe. If they do, component
  // previews break — e.g. links render with PDS purple instead of component-defined colors.
  //
  // Puck copies ALL parent page stylesheets into its canvas iframe via:
  //   doc.querySelectorAll('style, link[rel="stylesheet"]')
  // (puckeditor/core dist/index.js collectStyles function)
  //
  // There is no exclusion mechanism in Puck's IframeConfig API.
  //
  // SOLUTION: document.adoptedStyleSheets uses the CSS Object Model directly and does
  // NOT create DOM elements. Puck's querySelectorAll cannot find adopted stylesheets,
  // so they are never copied into the canvas iframe. PDS tokens remain available to
  // all editor chrome components (header, subheader, sidebars) via var(--pds-*).
  //
  // pds-core-content.ts is a committed JS string export generated from
  // pds-core.css at build time. Regenerate it by running the build script after
  // updating @pantheon-systems/pds-toolkit-react.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.adoptedStyleSheets) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(pdsCoreCSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== sheet);
    };
  }, []);

  // .puck-editor-theme is applied here — NOT by consuming apps — so the PDS
  // variable remapping in PuckEditorTheme.css is always active without any
  // configuration required from downstream. The canvas iframe is a sibling in
  // the CSS cascade sense (separate document), so rules inside .puck-editor-theme
  // do not affect canvas content.
  return (
    <div className="puck-editor-theme">
      {/* PDS's overlays read a context only GlobalWrapper supplies, and versions the peer
          range still admits throw without it. At the root so chrome, the login page and
          consumer children are all covered; it emits no DOM element and nesting is a no-op. */}
      <GlobalWrapper>
        <P1AuthProvider
          authMode={config.authMode}
          p1BaseUrl={config.baseUrl}
        >
          <AuthGate
            config={config}
            loadingFallback={loadingFallback}
            loginFallback={loginFallback}
            loginPageProps={loginPageProps}
          >
            {children}
          </AuthGate>
        </P1AuthProvider>
      </GlobalWrapper>
    </div>
  );
}
