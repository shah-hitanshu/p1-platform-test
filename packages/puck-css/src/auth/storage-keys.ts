// Shared by P1AuthProvider and performLogout. They live here so neither module
// has to import the other just to agree on a key name.

/** localStorage key holding the auth token, unless the consumer overrides it. */
export const DEFAULT_TOKEN_KEY = 'p1_auth_token';

/** Set once a user is authenticated; read by host apps to show signed-in UI. */
export const P1_LOGGED_IN_KEY = 'p1_logged_in';
