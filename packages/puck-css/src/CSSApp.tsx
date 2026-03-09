import React, { useMemo } from 'react';
import { CSSClient } from '@pantheon/css-client';
import { CSSAuthProvider, useCSSAuth, CSSLoginPage } from './auth/index.js';
import { CSSPuckProvider } from './CSSPuckProvider.js';
import { FocusHighlightProvider } from './FocusHighlightContext.js';
import { useCSSPuck } from './CSSPuckContext.js';
import { createFocusRegionMap } from './utils/focusRegionMap.js';
import type { CSSConfig } from './config.js';

export interface CSSAppProps {
  config: CSSConfig;
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
}: CSSAppProps): React.ReactElement {
  const { isAuthenticated, isLoading, user, token } = useCSSAuth();

  if (isLoading) {
    return <>{loadingFallback ?? <div style={{ textAlign: 'center', padding: '2rem' }}>Authenticating...</div>}</>;
  }

  if (!isAuthenticated) {
    if (loginFallback) {
      return loginFallback;
    }
    return <CSSLoginPage {...loginPageProps} />;
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
  config: CSSConfig;
  user: { id: string; name: string; email?: string };
  token: string;
  children: React.ReactNode;
}): React.ReactElement {
  const cssClient = useMemo(
    () =>
      new CSSClient({
        baseUrl: config.clientBaseUrl || config.baseUrl,
        authProvider: async () => `Bearer ${token}`,
      }),
    [config.clientBaseUrl, config.baseUrl, token]
  );

  return (
    <CSSPuckProvider
      key={`${user.id}-${token}`}
      client={cssClient}
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
    >
      {config.enablePresence ? (
        <PresenceFocusBridge userId={user.id}>{children}</PresenceFocusBridge>
      ) : (
        children
      )}
    </CSSPuckProvider>
  );
}

/**
 * Bridge component that reads presence data from CSSPuckProvider context
 * and computes the focusMap for FocusHighlightProvider.
 * Must be rendered inside CSSPuckProvider.
 */
function PresenceFocusBridge({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const css = useCSSPuck();

  const focusMap = useMemo(() => {
    if (!css.presence) return new Map();
    const otherActors = css.presence.actors.filter((a) => a.actorId !== userId);
    return createFocusRegionMap(css.safeData, otherActors);
  }, [css.presence, css.safeData, userId]);

  return (
    <FocusHighlightProvider focusMap={focusMap}>
      {children}
    </FocusHighlightProvider>
  );
}

export function CSSApp({
  config,
  children,
  loadingFallback,
  loginFallback,
  loginPageProps,
}: CSSAppProps): React.ReactElement {
  return (
    <CSSAuthProvider
      authMode={config.authMode}
      cssBaseUrl={config.baseUrl}
      googleClientId={config.googleClientId}
      auth0Domain={config.auth0Domain}
      auth0ClientId={config.auth0ClientId}
      auth0Audience={config.auth0Audience}
    >
      <AuthGate
        config={config}
        loadingFallback={loadingFallback}
        loginFallback={loginFallback}
        loginPageProps={loginPageProps}
      >
        {children}
      </AuthGate>
    </CSSAuthProvider>
  );
}
