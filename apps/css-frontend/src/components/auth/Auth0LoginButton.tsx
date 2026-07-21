/**
 * Auth0 Login Button
 *
 * Triggers Auth0 redirect-based login flow.
 * Only rendered when Auth0 is configured via environment variables.
 */

import { useAuth0 } from '@auth0/auth0-react';
import { Button } from '@pantheon-systems/pds-toolkit-react';

export function Auth0LoginButton() {
  const { loginWithRedirect, isLoading } = useAuth0();

  const handleClick = () => {
    loginWithRedirect();
  };

  return (
    <Button
      variant="secondary"
      label="Log in with Auth0"
      onClick={handleClick}
      disabled={isLoading}
      isLoading={isLoading}
      data-testid="auth0-login-button"
    />
  );
}
