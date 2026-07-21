/**
 * Main Entry Point
 *
 * Initializes the React application with providers.
 * Conditionally wraps with Google and Auth0 providers based on env config.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GlobalWrapper } from '@pantheon-systems/pds-toolkit-react';
import { AuthProvider } from './context/AuthContext';
import { OAuthProviders } from './components/OAuthProviders';
import App from './App';

import '@pantheon-systems/pds-toolkit-react/css/pds-core.css';
import '@pantheon-systems/pds-toolkit-react/css/pds-layouts.css';
import '@pantheon-systems/pds-toolkit-react/index.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <GlobalWrapper>
        <OAuthProviders>
          <AuthProvider>
            <App />
          </AuthProvider>
        </OAuthProviders>
      </GlobalWrapper>
    </BrowserRouter>
  </StrictMode>
);
