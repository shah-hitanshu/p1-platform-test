/**
 * Main Entry Point
 *
 * Initializes the React application with providers.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import App from './App';

// PDS (Pantheon Design System) global styles - must be imported before app styles
import '@pantheon-systems/design-toolkit-react/dist/index.css';

// App-specific style overrides (loaded after PDS)
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
