/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CSS_BASE_URL: string;
  readonly VITE_CSS_API_KEY: string;
  readonly VITE_CSS_SITE_ID: string;
  readonly VITE_CSS_BRANCH_ID: string;
  readonly VITE_CSS_USER_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
