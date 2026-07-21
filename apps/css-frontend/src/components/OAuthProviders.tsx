/**
 * OAuth Providers Wrapper
 *
 * Conditionally wraps the app with Google and Auth0 providers
 * based on environment variable configuration. The provider libraries
 * are always imported but only rendered when their env vars are set.
 */

import type { ReactNode } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Auth0Provider } from '@auth0/auth0-react';
import { getAuthConfig } from '../utils/auth-config';

const config = getAuthConfig();

export function OAuthProviders({ children }: { children: ReactNode }) {
  let wrapped = children;

  if (config.auth0.enabled) {
    wrapped = (
      <Auth0Provider
        domain={config.auth0.domain}
        clientId={config.auth0.clientId}
        authorizationParams={{
          redirect_uri: window.location.origin,
          ...(config.auth0.audience ? { audience: config.auth0.audience } : {}),
        }}
      >
        {wrapped}
      </Auth0Provider>
    );
  }

  if (config.google.enabled) {
    wrapped = (
      <GoogleOAuthProvider clientId={config.google.clientId}>
        {wrapped}
      </GoogleOAuthProvider>
    );
  }

  return <>{wrapped}</>;
}
