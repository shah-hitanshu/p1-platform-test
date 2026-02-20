/**
 * Google Login Button
 *
 * Wraps the @react-oauth/google GoogleLogin component.
 * Only rendered when Google OAuth is configured via environment variables.
 */

import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import type { CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../../hooks/useAuth';
import { Alert } from '@pantheon-systems/design-toolkit-react';

export function GoogleLoginButton() {
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = async (response: CredentialResponse) => {
    if (!response.credential) {
      setError('No credential received from Google.');
      return;
    }

    try {
      setError(null);
      await loginWithGoogle(response.credential);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed. Try again.');
    }
  };

  const handleError = () => {
    setError('Google login was unsuccessful. Try again.');
  };

  return (
    <div data-testid="google-login-container">
      <GoogleLogin
        onSuccess={handleSuccess}
        onError={handleError}
        text="signin_with"
      />
      {error && (
        <Alert type="danger" data-testid="google-login-error">
          {error}
        </Alert>
      )}
    </div>
  );
}
