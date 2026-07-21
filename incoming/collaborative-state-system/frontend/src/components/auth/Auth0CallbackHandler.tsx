/**
 * Auth0 Callback Handler
 *
 * Watches for Auth0 authentication completion after redirect.
 * When Auth0 confirms authentication, retrieves the access token
 * and passes it to our AuthContext.
 */

import { useEffect, useRef } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useAuth } from '../../hooks/useAuth';

export function Auth0CallbackHandler() {
  const { isAuthenticated: auth0IsAuthenticated, isLoading, getAccessTokenSilently, user } = useAuth0();
  const { loginWithAuth0Token, isAuthenticated: appIsAuthenticated } = useAuth();
  const handledRef = useRef(false);

  useEffect(() => {
    if (isLoading || !auth0IsAuthenticated || appIsAuthenticated || handledRef.current) {
      return;
    }

    handledRef.current = true;

    const handleCallback = async () => {
      const token = await getAccessTokenSilently();
      await loginWithAuth0Token(token, {
        sub: user?.sub ?? '',
        email: user?.email,
        name: user?.name,
      });
    };

    handleCallback();
  }, [auth0IsAuthenticated, isLoading, appIsAuthenticated, getAccessTokenSilently, user, loginWithAuth0Token]);

  return null;
}
