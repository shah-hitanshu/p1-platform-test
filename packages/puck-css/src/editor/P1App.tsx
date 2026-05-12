import React, { useEffect, useMemo, useRef } from 'react';
import { P1Client } from '@pantheon-systems/css-client';
import { P1AuthProvider, useP1Auth, P1LoginPage } from '../auth/index.js';
import { P1PuckProvider } from './P1PuckProvider.js';
import { useP1Puck } from '../core/P1PuckContext.js';
import { useOptionalPresenceContext } from '../core/PresenceContext.js';
import { createFocusRegionMap } from '../collaboration/utils/focusRegionMap.js';
import type { FocusHighlight } from '../collaboration/utils/focusRegionMap.js';
import type { P1Config } from '../core/config.js';
import { pdsCoreCSS } from '../pds/theme/pds-core-content.js';

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
    return <>{loadingFallback ?? <div style={{ textAlign: 'center', padding: '2rem' }}>Authenticating...</div>}</>;
  }

  if (!isAuthenticated) {
    if (loginFallback) {
      return loginFallback;
    }
    return <P1LoginPage {...loginPageProps} />;
  }

  if (!user || !token) {
    return <>{loadingFallback ?? <div style={{ textAlign: 'center', padding: '2rem' }}>Initializing...</div>}</>;
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

/**
 * Bridge component that reads presence data from P1PuckProvider context
 * and applies focus highlights directly to the DOM via Puck's
 * [data-puck-component] attributes. This avoids React re-renders in the
 * component tree, preventing scroll jumps and layout recalculation.
 * Must be rendered inside P1PuckProvider.
 */
function PresenceFocusBridge({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const css = useP1Puck();
  // Read presence from the dedicated PresenceContext (which updates reactively
  // on presence changes) instead of the main P1Puck context (which now uses
  // a ref-based getter to avoid cascading re-renders through the plugin tree).
  const presenceCtx = useOptionalPresenceContext();
  const prevHighlightedRef = useRef<Set<string>>(new Set());

  const focusMap = useMemo(() => {
    if (!presenceCtx) return new Map<string, FocusHighlight>();
    const otherActors = presenceCtx.actors.filter((a) => a.actorId !== userId);
    return createFocusRegionMap(css.safeData, otherActors);
  }, [presenceCtx, css.safeData, userId]);

  // Apply highlights via CSS class/style changes only — no DOM insertions.
  // Badge is rendered via CSS ::after pseudo-element to avoid DOM mutations
  // that can trigger browser auto-scroll before user interaction.
  useEffect(() => {
    const iframe = document.getElementById('preview-frame') as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument ?? document;

    // Remove highlights from previously highlighted components
    prevHighlightedRef.current.forEach((componentId) => {
      if (!focusMap.has(componentId)) {
        const el = doc.querySelector(`[data-puck-component="${componentId}"]`);
        if (el) {
          el.classList.remove('focus-region-highlight', 'focus-region-highlight--editing');
          (el as HTMLElement).style.removeProperty('--focus-color');
          el.removeAttribute('data-focus-actor');
          el.removeAttribute('data-focus-initial');
        }
      }
    });

    // Apply highlights — only classList and style changes, no child elements
    const currentHighlighted = new Set<string>();
    focusMap.forEach((highlight, componentId) => {
      currentHighlighted.add(componentId);
      const el = doc.querySelector(`[data-puck-component="${componentId}"]`);
      if (!el) return;

      el.classList.add('focus-region-highlight');
      if (highlight.isEditing) {
        el.classList.add('focus-region-highlight--editing');
      } else {
        el.classList.remove('focus-region-highlight--editing');
      }
      (el as HTMLElement).style.setProperty('--focus-color', highlight.color);
      el.setAttribute('data-focus-actor', highlight.actorId);
      el.setAttribute('data-focus-initial', highlight.actorName.charAt(0).toUpperCase());
    });

    prevHighlightedRef.current = currentHighlighted;
  }, [focusMap]);

  return <>{children}</>;
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
      <P1AuthProvider
        authMode={config.authMode}
        p1BaseUrl={config.baseUrl}
        siteId={config.siteId}
        googleClientId={config.googleClientId}
        auth0Domain={config.auth0Domain}
        auth0ClientId={config.auth0ClientId}
        auth0Audience={config.auth0Audience}
        p1AuthServerUrl={config.p1AuthServerUrl}
        p1AuthRedirectUri={config.p1AuthRedirectUri}
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
    </div>
  );
}
