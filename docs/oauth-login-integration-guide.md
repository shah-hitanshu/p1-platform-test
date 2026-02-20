# OAuth Login Integration Guide

> **Last Updated:** February 2026
> **System:** Collaborative State System (CSS)

This guide covers how frontend applications authenticate with the CSS backend using OAuth providers (Google and Auth0) and the `css-client` library.

---

## Prerequisites

- The CSS backend already validates Google OAuth2 ID tokens and Auth0 JWTs. No backend code changes are needed to authenticate users.
- Your frontend application must obtain a token from the OAuth provider and send it as a `Bearer` token in the `Authorization` header.
- The backend must have the appropriate environment variables configured (see [Backend Configuration](#backend-configuration)).

---

## Authentication Flow Overview

```
┌──────────────┐     ┌────────────────────┐     ┌──────────────────┐
│   Frontend   │     │  OAuth Provider    │     │   CSS Backend    │
│   (Browser)  │     │  (Google / Auth0)  │     │  (Cloudflare)    │
└──────┬───────┘     └────────┬───────────┘     └────────┬─────────┘
       │                      │                          │
       │  1. Redirect / popup │                          │
       │─────────────────────>│                          │
       │                      │                          │
       │  2. User logs in     │                          │
       │<─────────────────────│                          │
       │     (ID token / access token)                   │
       │                      │                          │
       │  3. API request with Bearer token               │
       │────────────────────────────────────────────────>│
       │                      │                          │
       │                      │  4. Verify token via     │
       │                      │     JWKS (signature +    │
       │                      │     issuer + audience)   │
       │                      │                          │
       │                      │  5. Map provider subject │
       │                      │     ID to UUIDv5         │
       │                      │                          │
       │  6. Response (200 / 401 / 403)                  │
       │<────────────────────────────────────────────────│
```

**How it works:**

1. The frontend initiates an OAuth flow with the provider (Google or Auth0).
2. The provider returns a JWT (ID token for Google, access token for Auth0).
3. The frontend sends API requests to CSS with the token in the `Authorization: Bearer <token>` header.
4. The CSS backend decodes the JWT `iss` claim (without verification) to route to the correct identity provider, which then performs full signature verification using the provider's JWKS endpoint.
5. The provider's subject ID (`sub` claim) is deterministically mapped to a UUID using UUIDv5 (see [User Provisioning](#user-provisioning)).
6. The backend returns an `AuthenticatedPrincipal` containing the user's ID, email, auth provider, and token expiry.

---

## Google OAuth Integration

### Setup

Use Google Identity Services (GIS) to obtain ID tokens in the browser.

**1. Install the GIS library:**

Add the script tag to your HTML:

```html
<script src="https://accounts.google.com/gsi/client" async></script>
```

Or install the types for TypeScript:

```bash
npm install --save-dev @types/google.accounts
```

**2. Initialize and request a token:**

```typescript
// Initialize the Google Identity Services client
google.accounts.id.initialize({
  client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  callback: handleCredentialResponse,
});

// Render the Sign In button
google.accounts.id.renderButton(
  document.getElementById('google-signin-btn')!,
  { theme: 'outline', size: 'large' },
);

function handleCredentialResponse(response: google.accounts.id.CredentialResponse) {
  const idToken = response.credential;

  // Store the token and use it for CSS API calls
  localStorage.setItem('css_auth_token', idToken);
}
```

**3. Make authenticated API calls:**

```typescript
const token = localStorage.getItem('css_auth_token');

const response = await fetch('https://your-css-backend.example.com/api/sites', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});

if (response.status === 401) {
  // Token expired or invalid - re-authenticate
  google.accounts.id.prompt();
}
```

### Google Token Details

- **Issuer (`iss`):** `https://accounts.google.com` or `accounts.google.com` (both accepted)
- **Audience (`aud`):** Must match `GOOGLE_CLIENT_ID` configured on the backend
- **Algorithm:** RS256
- **JWKS endpoint:** `https://www.googleapis.com/oauth2/v3/certs`
- **Token lifetime:** Typically 1 hour

---

## Auth0 Integration

### Setup

Use the Auth0 SPA SDK to obtain access tokens.

**1. Install the SDK:**

```bash
npm install @auth0/auth0-spa-js
```

**2. Initialize the client:**

```typescript
import { createAuth0Client, Auth0Client } from '@auth0/auth0-spa-js';

const auth0 = await createAuth0Client({
  domain: 'your-tenant.auth0.com',
  clientId: 'YOUR_AUTH0_CLIENT_ID',
  authorizationParams: {
    audience: 'YOUR_AUTH0_AUDIENCE',
    redirect_uri: window.location.origin,
  },
});
```

**3. Login and obtain tokens:**

```typescript
// Redirect-based login
await auth0.loginWithRedirect();

// After redirect, handle the callback
await auth0.handleRedirectCallback();

// Get the access token for API calls
const token = await auth0.getTokenSilently();
```

**4. Make authenticated API calls:**

```typescript
const token = await auth0.getTokenSilently();

const response = await fetch('https://your-css-backend.example.com/api/sites', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});

if (response.status === 401) {
  // Token expired - try silent refresh or redirect to login
  try {
    const newToken = await auth0.getTokenSilently();
    // Retry the request
  } catch {
    await auth0.loginWithRedirect();
  }
}
```

### Auth0 Token Details

- **Issuer (`iss`):** Matches `AUTH0_ISSUER_BASE_URL` (or `AUTH0_NEW_ISSUER_BASE_URL` during tenant migration)
- **Audience (`aud`):** Must match `AUTH0_AUDIENCE` configured on the backend
- **Algorithm:** RS256
- **JWKS endpoint:** `{issuerBaseUrl}/.well-known/jwks.json`
- **Dual-issuer support:** The backend supports migration between Auth0 tenants by accepting tokens from both the primary and new issuer URLs simultaneously

---

## Using css-client's AuthProvider and TokenStorage

The `css-client` package provides authentication abstractions that integrate with the CSS API client.

### AuthProvider

`AuthProvider` is a function type that returns the authorization header value:

```typescript
import type { AuthProvider } from '@anthropic/css-client';

// Type: () => Promise<string>
```

### TokenStorage

`TokenStorage` is an interface for managing auth tokens:

```typescript
interface TokenStorage {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}
```

### Built-in Implementations

**InMemoryTokenStorage** - for testing or single-session apps:

```typescript
import { InMemoryTokenStorage } from '@anthropic/css-client';

const storage = new InMemoryTokenStorage();
await storage.setToken(myToken);
```

**LocalStorageTokenStorage** - for browser apps with persistent sessions:

```typescript
import { LocalStorageTokenStorage } from '@anthropic/css-client';

const storage = new LocalStorageTokenStorage('css_auth_token');
// Token persists across page reloads
```

### Creating Auth Providers

**Token-based auth (for human users with OAuth tokens):**

```typescript
import { createTokenAuth, LocalStorageTokenStorage } from '@anthropic/css-client';

const tokenStorage = new LocalStorageTokenStorage();
const authProvider = createTokenAuth(tokenStorage);

// Use with the CSS client
const client = new CssClient({
  baseUrl: 'https://your-css-backend.example.com',
  auth: authProvider,
});
```

**API key auth (for agents/services):**

```typescript
import { createApiKeyAuth } from '@anthropic/css-client';

const authProvider = createApiKeyAuth('your-agent-api-key');
```

### Full Example: Google OAuth + css-client

```typescript
import { createTokenAuth, LocalStorageTokenStorage } from '@anthropic/css-client';

const tokenStorage = new LocalStorageTokenStorage('css_google_token');

// When the user logs in via Google
function handleCredentialResponse(response: google.accounts.id.CredentialResponse) {
  tokenStorage.setToken(response.credential);
}

// Create the CSS client with token auth
const authProvider = createTokenAuth(tokenStorage);
const client = new CssClient({
  baseUrl: 'https://your-css-backend.example.com',
  auth: authProvider,
});

// API calls automatically include the Bearer token
const sites = await client.listSites();
```

### Full Example: Auth0 + css-client

```typescript
import { createTokenAuth } from '@anthropic/css-client';
import type { TokenStorage } from '@anthropic/css-client';
import { createAuth0Client } from '@auth0/auth0-spa-js';

// Custom TokenStorage backed by Auth0's token cache
class Auth0TokenStorage implements TokenStorage {
  constructor(private auth0: Auth0Client) {}

  async getToken(): Promise<string | null> {
    try {
      return await this.auth0.getTokenSilently();
    } catch {
      return null;
    }
  }

  async setToken(_token: string): Promise<void> {
    // Auth0 SDK manages token storage internally
  }

  async clearToken(): Promise<void> {
    await this.auth0.logout({ logoutParams: { returnTo: window.location.origin } });
  }
}

const auth0 = await createAuth0Client({
  domain: 'your-tenant.auth0.com',
  clientId: 'YOUR_CLIENT_ID',
  authorizationParams: { audience: 'YOUR_AUDIENCE' },
});

const tokenStorage = new Auth0TokenStorage(auth0);
const authProvider = createTokenAuth(tokenStorage);

const client = new CssClient({
  baseUrl: 'https://your-css-backend.example.com',
  auth: authProvider,
});
```

---

## Backend Configuration

The CSS backend requires the following environment variables to enable OAuth providers:

### Google OAuth

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | Your Google OAuth client ID (e.g., `123456.apps.googleusercontent.com`). The backend activates the Google provider when this is set. |

### Auth0

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH0_ISSUER_BASE_URL` | Yes | Primary Auth0 tenant URL (e.g., `https://your-tenant.auth0.com`). |
| `AUTH0_AUDIENCE` | Yes | Expected audience for token validation. Both issuer and audience must be set to activate the Auth0 provider. |
| `AUTH0_NEW_ISSUER_BASE_URL` | No | New Auth0 tenant URL for dual-issuer migration. Set this when migrating between Auth0 tenants; tokens from both issuers will be accepted. |

### Mock Auth (Development Only)

| Variable | Required | Description |
|----------|----------|-------------|
| `MOCK_JWT_SECRET` | No | Secret for signing mock JWTs. Defaults to a development placeholder. The mock provider is automatically enabled in non-production environments. |

---

## User Provisioning

When a user authenticates via Google or Auth0, the CSS backend deterministically maps their OAuth subject ID (`sub` claim) to a UUID using UUIDv5. This means:

- The same user always gets the same CSS user ID regardless of when they first authenticate.
- No explicit user registration step is required.
- Google and Auth0 users with the same email address will have **different** CSS user IDs because the mapping is per-provider.

### How UUIDv5 Mapping Works

Each provider has a fixed namespace UUID:

| Provider | Namespace UUID |
|----------|---------------|
| Google | `6ba7b810-9dad-51d0-80b4-00c04fd430c8` |
| Auth0 | `6ba7b811-9dad-51d0-80b4-00c04fd430c8` |

The mapping formula is:

```
CSS User ID = UUIDv5(providerNamespace, providerSubjectId)
```

For example, if Google returns `sub: "114823571234567890"`, the CSS user ID will always be the same deterministic UUID derived from `UUIDv5("6ba7b810-...", "114823571234567890")`.

### Implications for Site Roles

After authentication, the user's site access is determined by looking up their CSS user ID in the `user_site_roles` table. A user will have `NO_ACCESS` until a role is explicitly granted for a specific site (via MAS synchronization, local grants, or the collaborator API).

---

## The /api/auth/me Endpoint

The `/api/auth/me` endpoint allows clients to validate their token and retrieve their authenticated identity.

### Request

```
GET /api/auth/me
Authorization: Bearer <token>
```

### Response (200 OK)

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "type": "user",
  "email": "user@example.com",
  "authProvider": "google",
  "tokenExpiry": "2026-02-19T15:30:00.000Z",
  "providerSubjectId": "114823571234567890"
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | The user's CSS UUID (derived via UUIDv5 from the provider subject ID) |
| `type` | `string` | Principal type: `"user"`, `"agent"`, or `"service"` |
| `email` | `string?` | Email from the OAuth token (if available) |
| `authProvider` | `string` | Which provider validated the token: `"google"`, `"auth0"`, or `"mock"` |
| `tokenExpiry` | `string` | ISO 8601 timestamp when the token expires |
| `providerSubjectId` | `string?` | Original `sub` claim from the OAuth provider |

### Error Responses

| Status | Meaning |
|--------|---------|
| `401` | Missing, expired, or invalid token |

### Usage Example

```typescript
// Validate token and get user info on app startup
async function getCurrentUser(token: string) {
  const response = await fetch('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (response.status === 401) {
    return null; // Token invalid or expired
  }

  return await response.json();
}
```

---

## Development Mode

In non-production environments, the CSS backend provides a mock identity provider for local development and testing.

### Listing Available Mock Users

```
GET /api/auth/users
```

Returns all preconfigured mock users and agents:

```json
{
  "users": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "email": "alice@example.com",
      "name": "Alice Developer",
      "siteRoles": { "site-123": "admin", "site-456": "developer" }
    },
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "email": "bob@example.com",
      "name": "Bob Reviewer",
      "siteRoles": { "site-123": "team_member" }
    }
  ],
  "agents": [
    {
      "id": "a0000000-0000-0000-0000-000000000001",
      "name": "Zappy AI Assistant",
      "siteRoles": { "site-123": "editor" }
    }
  ]
}
```

### Issuing Mock Tokens

```
POST /api/auth/token
Content-Type: application/json

{
  "userId": "11111111-1111-1111-1111-111111111111"
}
```

Response:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "alice@example.com",
    "name": "Alice Developer",
    "siteRoles": { "site-123": "admin" }
  }
}
```

Use the returned token as `Authorization: Bearer <token>` for subsequent API calls.

### Development Workflow

```typescript
// 1. List available users
const usersResp = await fetch('/api/auth/users');
const { users } = await usersResp.json();

// 2. Pick a user and get a token
const tokenResp = await fetch('/api/auth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: users[0].id }),
});
const { token } = await tokenResp.json();

// 3. Use the token for API calls
const sitesResp = await fetch('/api/sites', {
  headers: { 'Authorization': `Bearer ${token}` },
});
```

---

## Error Handling

### HTTP Status Codes

| Status | Meaning | When It Occurs |
|--------|---------|----------------|
| `401 Unauthorized` | Authentication failed | Missing `Authorization` header, expired token, invalid signature, unknown issuer, audience mismatch |
| `403 Forbidden` | Authorization failed | Token is valid but the user lacks the required permission for the requested operation |

### 401 vs 403

- **401** means the system does not know who you are. The token is missing, malformed, expired, or was not signed by a recognized provider. **Action:** Re-authenticate with the OAuth provider to get a fresh token.
- **403** means the system knows who you are but you are not allowed to perform the action. **Action:** Check whether the user has the required site role or branch grant. Contact a site admin to grant access.

### Token Expiry

OAuth tokens have limited lifetimes (typically 1 hour for Google, configurable for Auth0). Your frontend should handle token refresh:

```typescript
async function fetchWithAuth(url: string, options: RequestInit = {}) {
  let token = await tokenStorage.getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    // Token expired - attempt refresh
    token = await refreshToken(); // Provider-specific refresh logic
    if (!token) {
      throw new Error('Session expired. Please log in again.');
    }
    await tokenStorage.setToken(token);

    // Retry the request with the new token
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
      },
    });
  }

  return response;
}
```

---

## Complete Minimal Examples

### Google OAuth - Minimal Working Example

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://accounts.google.com/gsi/client" async></script>
</head>
<body>
  <div id="google-signin-btn"></div>
  <pre id="output"></pre>

  <script>
    const CSS_API = 'https://your-css-backend.example.com';

    function handleCredentialResponse(response) {
      localStorage.setItem('css_auth_token', response.credential);
      fetchMe();
    }

    async function fetchMe() {
      const token = localStorage.getItem('css_auth_token');
      const resp = await fetch(`${CSS_API}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await resp.json();
      document.getElementById('output').textContent = JSON.stringify(data, null, 2);
    }

    window.onload = () => {
      google.accounts.id.initialize({
        client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
        callback: handleCredentialResponse,
      });
      google.accounts.id.renderButton(
        document.getElementById('google-signin-btn'),
        { theme: 'outline', size: 'large' },
      );
    };
  </script>
</body>
</html>
```

### Auth0 - Minimal Working Example

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.auth0.com/js/auth0-spa-js/2.0/auth0-spa-js.production.js"></script>
</head>
<body>
  <button id="login-btn">Log In</button>
  <button id="logout-btn" style="display:none">Log Out</button>
  <pre id="output"></pre>

  <script>
    const CSS_API = 'https://your-css-backend.example.com';
    let auth0 = null;

    async function init() {
      auth0 = await auth0.createAuth0Client({
        domain: 'your-tenant.auth0.com',
        clientId: 'YOUR_AUTH0_CLIENT_ID',
        authorizationParams: {
          audience: 'YOUR_AUTH0_AUDIENCE',
          redirect_uri: window.location.origin,
        },
      });

      // Handle redirect callback
      if (window.location.search.includes('code=')) {
        await auth0.handleRedirectCallback();
        window.history.replaceState({}, document.title, '/');
      }

      const isAuthenticated = await auth0.isAuthenticated();
      if (isAuthenticated) {
        document.getElementById('login-btn').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'inline';
        await fetchMe();
      }
    }

    async function fetchMe() {
      const token = await auth0.getTokenSilently();
      const resp = await fetch(`${CSS_API}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await resp.json();
      document.getElementById('output').textContent = JSON.stringify(data, null, 2);
    }

    document.getElementById('login-btn').onclick = () => auth0.loginWithRedirect();
    document.getElementById('logout-btn').onclick = () =>
      auth0.logout({ logoutParams: { returnTo: window.location.origin } });

    init();
  </script>
</body>
</html>
```
