/**
 * P1 Auth module
 *
 * Reusable authentication components for P1-integrated React apps.
 * Exports P1AuthProvider, useP1Auth, and P1LoginPage.
 *
 * For standalone apps, use P1LoginPage as a ready-made login screen.
 * For embedded apps, use useP1Auth() to build your own login UI.
 */

export {
  P1AuthProvider,
  useP1Auth,
  useOptionalP1Auth,
  DEMO_USERS,
} from './P1AuthProvider.js';
export type {
  AuthMode,
  AuthUser,
  P1AuthContextValue,
  P1AuthProviderProps,
} from './P1AuthProvider.js';

export { P1LoginPage } from './P1LoginPage.js';
export type { P1LoginPageProps } from './P1LoginPage.js';
