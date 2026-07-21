/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for API requests (deployed frontends) */
  readonly VITE_API_BASE_URL?: string;

  /** Google OAuth client ID — enables Google login */
  readonly VITE_GOOGLE_CLIENT_ID?: string;

  /** Auth0 tenant domain — required for Auth0 login */
  readonly VITE_AUTH0_DOMAIN?: string;
  /** Auth0 application client ID — required for Auth0 login */
  readonly VITE_AUTH0_CLIENT_ID?: string;
  /** Auth0 API audience identifier — optional */
  readonly VITE_AUTH0_AUDIENCE?: string;

  /** Explicitly enable mock login alongside OAuth providers */
  readonly VITE_ENABLE_MOCK_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
