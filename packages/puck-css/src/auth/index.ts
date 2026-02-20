/**
 * CSS Auth module
 *
 * Reusable authentication components for CSS-integrated React apps.
 * Exports CSSAuthProvider, useCSSAuth, and CSSLoginPage.
 *
 * For standalone apps, use CSSLoginPage as a ready-made login screen.
 * For embedded apps, use useCSSAuth() to build your own login UI.
 */

export {
  CSSAuthProvider,
  useCSSAuth,
  DEMO_USERS,
} from './CSSAuthProvider.js';
export type {
  AuthMode,
  AuthUser,
  CSSAuthContextValue,
  CSSAuthProviderProps,
} from './CSSAuthProvider.js';

export { CSSLoginPage } from './CSSLoginPage.js';
export type { CSSLoginPageProps } from './CSSLoginPage.js';
