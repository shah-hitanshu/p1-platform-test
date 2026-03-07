import React from 'react';
import { CSSAuthProvider, useCSSAuth, CSSLoginPage } from './auth/CSSAuthProvider.js';
import type { CSSConfig } from './config.js';

export interface CSSAppProps {
  config: CSSConfig;
  children: React.ReactNode;
  loadingFallback?: React.ReactNode;
  loginFallback?: React.ReactElement;
  loginPageProps?: { title?: string; subtitle?: string };
}

function AuthGate({
  children,
  loadingFallback,
  loginFallback,
  loginPageProps,
}: Omit<CSSAppProps, 'config'>): React.ReactElement {
  const { isAuthenticated, isLoading } = useCSSAuth();

  if (isLoading) {
    return <>{loadingFallback ?? <div style={{ textAlign: 'center', padding: '2rem' }}>Authenticating...</div>}</>;
  }

  if (!isAuthenticated) {
    if (loginFallback) {
      return loginFallback;
    }
    return <CSSLoginPage {...loginPageProps} />;
  }

  return <>{children}</>;
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
        loadingFallback={loadingFallback}
        loginFallback={loginFallback}
        loginPageProps={loginPageProps}
      >
        {children}
      </AuthGate>
    </CSSAuthProvider>
  );
}
