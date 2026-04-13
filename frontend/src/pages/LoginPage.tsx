/**
 * Login Page
 *
 * Multi-provider login page supporting Google, Auth0, and mock authentication.
 * Provider sections are conditionally rendered based on environment configuration.
 */

import { isGoogleEnabled, isAuth0Enabled, isMockEnabled } from '../utils/auth-config';
import { GoogleLoginButton } from '../components/auth/GoogleLoginButton';
import { Auth0LoginButton } from '../components/auth/Auth0LoginButton';
import { Auth0CallbackHandler } from '../components/auth/Auth0CallbackHandler';
import { MockLoginForm } from '../components/auth/MockLoginForm';
import './LoginPage.css';

const googleEnabled = isGoogleEnabled();
const auth0Enabled = isAuth0Enabled();
const mockEnabled = isMockEnabled();
const hasOAuth = googleEnabled || auth0Enabled;

export function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-title" data-testid="login-title">Pantheon P1</h1>
          <p className="login-subtitle">Sign in to continue</p>
        </div>

        {/* OAuth provider buttons */}
        {googleEnabled && (
          <div className="login-section" data-testid="google-login-section">
            <GoogleLoginButton />
          </div>
        )}

        {auth0Enabled && (
          <div className="login-section" data-testid="auth0-login-section">
            <Auth0LoginButton />
          </div>
        )}

        {/* Auth0 callback handler (invisible, handles redirect) */}
        {auth0Enabled && <Auth0CallbackHandler />}

        {/* Divider between OAuth and mock login */}
        {hasOAuth && mockEnabled && (
          <div className="login-divider" data-testid="login-divider">
            <span>or</span>
          </div>
        )}

        {/* Mock login form */}
        {mockEnabled && (
          <div className="login-section" data-testid="mock-login-section">
            <MockLoginForm />
          </div>
        )}

        <div className="login-footer">
          {!hasOAuth && <p>This is a development environment with mock authentication.</p>}
          {hasOAuth && mockEnabled && <p>Mock login is available for local development.</p>}
        </div>
      </div>
    </div>
  );
}
