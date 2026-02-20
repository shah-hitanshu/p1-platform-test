# Authentication & Authorization Implementation Guide

> Based on Pantheon Content Publisher's authentication architecture

This guide documents the authentication and authorization patterns used in Pantheon Content Publisher and provides guidance for implementing similar systems in other applications.

> **Note on Pantheon's Membership and Authorization Service (MAS)**: PCC does **not** use Pantheon's centralized MAS for authorization. PCC uses Pantheon (via Auth0) strictly for **authentication (authN)** and manages all **authorization (authZ) internally** using Firestore-backed role and membership data. All permission checks query PCC's own Firestore collections directly — there are no calls to external authorization services.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Multi-Provider Authentication Strategy](#multi-provider-authentication-strategy)
3. [Token Management](#token-management)
4. [Authorization & Role System](#authorization--role-system)
5. [Permission Checking Patterns](#permission-checking-patterns)
6. [Account Mapping & Credential Management](#account-mapping--credential-management)
7. [Frontend Authentication](#frontend-authentication)
8. [Implementation Guide](#implementation-guide)
9. [Best Practices](#best-practices)
10. [Code Examples](#code-examples)

---

## Architecture Overview

Content Publisher implements a **multi-provider authentication system** with **self-contained, role-based authorization** backed by Firestore. PCC relies on external identity providers (Auth0, Google, Microsoft) solely for **authentication** — all authorization decisions are made internally without calling any external authorization service.

### Key Architectural Decisions

1. **Multiple Authentication Providers**: Support Auth0, Google OAuth, Microsoft/Azure AD, and custom scoped tokens
2. **Self-Contained Authorization**: All authZ is internal — Firestore stores site admins, collaborators, and account mappings. No dependency on Pantheon's MAS or any external authorization service
3. **Lazy Permission Evaluation**: Permissions computed on-demand with request-scoped caching
4. **Domain-Based Access Control**: Workspace domains provide automatic collaboration within organizations
5. **Hybrid Permission Model**: Combines external system permissions (Google Drive) with internal authorization (Firestore)
6. **Email Tier-Based Access**: Gmail addresses (`@gmail.com`) receive free-tier permissions; all other domains are treated as paid-tier with additional capabilities
7. **Request-Scoped User Object**: All permission methods attached to `req.user` for clean API design
8. **Account Mapping**: Auth0 users can connect Google/Microsoft accounts, enabling cross-provider Drive access via a Credential Manager service

### High-Level Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ Bearer Token
       ▼
┌──────────────────────────┐
│  Token Validation (authN)│  ← External providers
│  - Auth0 JWT             │
│  - Google ID Token       │
│  - Microsoft Token       │
│  - Scoped PCC Token      │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│  Populate req.user       │
│  + permission fns        │
│  + account mappings      │  ← Auth0 → Google account links
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│  Route Handler (authZ)   │  ← All internal (Firestore)
│  - Google Drive access   │
│  - Site admin/collab     │
│  - Domain/workspace      │
│  - Email tier (free/paid)│
└──────────────────────────┘
```

---

## Multi-Provider Authentication Strategy

### Why Multiple Providers?

- **User Choice**: Let users authenticate with their preferred identity provider
- **Enterprise Support**: Support SSO via Microsoft/Azure AD for enterprise customers
- **Flexibility**: Add new providers without architectural changes
- **Migration**: Support legacy auth while introducing new systems

### Provider Enumeration

```typescript
enum AuthProvider {
  auth0 = 'auth0',      // Auth0 OAuth2/OIDC
  google = 'google',    // Google OAuth2 + ID tokens
  ms = 'ms',            // Microsoft/Azure AD
  pcc = 'pcc',          // Custom scoped tokens
  unknown = 'unknown'
}
```

### Implementation Pattern

**File**: `middleware/auth/index.ts`

```typescript
export function requireAuth(options?: AuthOptions): Middleware {
  return async (req, res, next) => {
    try {
      // 1. Extract token from Authorization header
      const token = extractBearerToken(req);

      // 2. Determine provider by token characteristics
      const provider = detectProvider(token);

      // 3. Validate token with appropriate validator
      let user;
      switch (provider) {
        case 'auth0':
          user = await validateAuth0Token(token);
          break;
        case 'google':
          user = await validateGoogleToken(token);
          break;
        case 'ms':
          user = await validateMicrosoftToken(token);
          break;
        case 'pcc':
          user = await validateScopedToken(token);
          break;
        default:
          throw new UnauthorizedError('Unknown token type');
      }

      // 4. Attach permission methods to user object
      req.user = enhanceUserWithPermissions(user, provider, token);

      // 5. Apply provider/scope restrictions
      if (options?.allowedProviders &&
          !options.allowedProviders.includes(provider)) {
        throw new ForbiddenError('Provider not allowed');
      }

      if (options?.scope) {
        verifyTokenScope(req.scopedJWTClaims, options.scope);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
```

### Token Detection Strategy

```typescript
function detectProvider(token: string): AuthProvider {
  try {
    const decoded = jwt.decode(token, { complete: true });

    // Check issuer for Auth0
    if (decoded.payload.iss?.includes('auth0.com')) {
      return 'auth0';
    }

    // Check audience for Google
    if (decoded.payload.aud?.includes('googleusercontent.com')) {
      return 'google';
    }

    // Check issuer for Microsoft
    if (decoded.payload.iss?.includes('microsoftonline.com')) {
      return 'ms';
    }

    // Check custom claims for scoped tokens
    if (decoded.payload.scope) {
      return 'pcc';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}
```

---

## Token Management

### Token Types

Content Publisher uses **6 distinct token types**:

| Token Type | Provider | Algorithm | Use Case |
|-----------|----------|-----------|----------|
| Auth0 JWT | Auth0 | RS256 | Primary user authentication |
| Google ID Token | Google | RS256 | OAuth login + Drive access |
| Microsoft Token | Azure AD | RS256 | Enterprise SSO |
| Scoped JWT | Internal | HS256 | Limited-purpose operations |
| Management Token | Internal | SHA256 hash | Admin API access |
| Collection Token | Internal | SHA256 hash | External integrations |

### Auth0 JWT Validation

**Challenge**: Support multiple Auth0 issuers during migration between Auth0 tenants or to a custom domain. The code supports `AUTH0_ISSUER_BASE_URL` (original) and `AUTH0_NEW_ISSUER_BASE_URL` (new/custom domain) simultaneously.

```typescript
async function validateAuth0Token(token: string) {
  // 1. Decode without verification to get issuer
  const unverified = jwt.decode(token, { complete: true });
  const issuer = unverified.payload.iss;

  // 2. Select appropriate JWKS endpoint
  const jwksUri = issuer === process.env.AUTH0_ISSUER_BASE_URL
    ? `${process.env.AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json`
    : `${process.env.AUTH0_NEW_ISSUER_BASE_URL}/.well-known/jwks.json`;

  // 3. Fetch signing key
  const client = jwksClient({ jwksUri });
  const key = await client.getSigningKey(unverified.header.kid);

  // 4. Verify signature
  const verified = jwt.verify(token, key.getPublicKey(), {
    algorithms: ['RS256'],
    audience: SUPPORTED_AUDIENCES,
    issuer: issuer,
  });

  // 5. Extract user info
  return {
    email: verified.email,
    auth0Id: verified.sub,
    isAuth0Registered: true,
    authProvider: 'auth0',
  };
}
```

### Google ID Token Validation

```typescript
import { OAuth2Client } from 'google-auth-library';

async function validateGoogleToken(idToken: string) {
  const client = new OAuth2Client();

  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  return {
    email: payload.email,
    email_verified: payload.email_verified,
    domain: payload.hd, // Hosted domain for workspace accounts
    authProvider: 'google',
  };
}
```

### Scoped JWT Pattern

**Use Case**: Generate short-lived tokens for specific operations

```typescript
// Token scopes
type ScopedJWTTypes = {
  'pcc_grant': { sub: string; site: string; isStatic?: boolean };
  'file.upload': { sub: string };
  'component.create': { articleId: string };
  'component.crud': { componentId: string };
};

// Generate scoped token
function generateScopedJWT<T extends keyof ScopedJWTTypes>(
  scope: T,
  claims: ScopedJWTTypes[T],
  expiresIn: string = '6h'
): string {
  return jwt.sign(
    { ...claims, scope },
    process.env.JWT_SECRET,
    { expiresIn, algorithm: 'HS256' }
  );
}

// Validate scoped token
function validateScopedJWT<T extends keyof ScopedJWTTypes>(
  token: string,
  expectedScope: T
): ScopedJWTTypes[T] {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
  });

  if (decoded.scope !== expectedScope) {
    throw new Error('Invalid token scope');
  }

  return decoded as ScopedJWTTypes[T];
}
```

### API Key Management

**Pattern**: Store hashed API keys in database

```typescript
import crypto from 'crypto';

// Generate API key
function generateAPIKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Hash for storage
function hashAPIKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Store in database
async function createAPIKey(email: string, keyType: 'management' | 'collection') {
  const key = generateAPIKey();
  const keyHash = hashAPIKey(key);

  await db.collection('apikeys').add({
    keyHash,
    keyType,
    email,
    isManagementKey: keyType === 'management',
    createdAt: new Date(),
    lastUsedAt: null,
  });

  // Return unhashed key ONCE to user
  return key;
}

// Validate API key
async function validateAPIKey(key: string): Promise<boolean> {
  const keyHash = hashAPIKey(key);
  const doc = await db.collection('apikeys').where('keyHash', '==', keyHash).get();

  if (doc.empty) {
    return false;
  }

  // Update last used timestamp
  await doc.docs[0].ref.update({ lastUsedAt: new Date() });

  return true;
}
```

---

## Authorization & Role System

### Role Definition Pattern

**File**: `permissions.ts`

```typescript
interface Role {
  // View permissions
  canView: boolean;
  canViewAnalytics?: boolean;
  canViewSite?: boolean;
  canViewMetadata?: boolean;
  canViewMetadataSchema?: boolean;
  canViewPublishedDocuments?: boolean;

  // Management permissions
  canManageAnalytics?: boolean;
  canManageSite?: boolean;
  canCreateSite?: boolean;
  canDeleteSite?: boolean;
  canEditSiteURL?: boolean;
  canManageUsers?: boolean;
  canManageMetadata?: boolean;
  canManageMetadataSchema?: boolean;
  canManagePublishedDocuments?: boolean;
  canManageTags?: boolean;
  canManageWebhook?: boolean;

  // Content permissions
  canEditComponent?: boolean;
  canEditArticle?: boolean;
  canPublish?: boolean;
  canUnpublish?: boolean;

  // Integration permissions
  canConnectToCollection?: boolean;

  // Context for permission calculation
  considerations?: AccessConsiderations;
}
```

### Access Considerations

These factors are gathered by `determineAccessConsiderations()` which queries both Google Drive (for document access) and Firestore (for site membership). For `INGEST_API` and `MS_OFFICE` content sources, only ownership-based checks are used since there is no way to independently verify access through a third-party API.

```typescript
interface AccessConsiderations {
  // Document-level access
  hasDocumentAccess: boolean;      // Via Google Drive API or ownership
  isOwner: boolean;                // File/resource owner
  hasEditAccess: boolean;          // Can modify content (Drive capabilities or ownership)

  // Organization-level access
  isGmail: boolean;                // Free tier (domain === '@gmail.com')
  isPaidAccount: boolean;          // Paid tier (!isGmail) — TODO: eventually pull from DB
  isSameWorkspace: boolean;        // User domain matches file owner domain

  // Site-level access
  isAdmin: boolean;                // In site's admins[] or originalCreator
  isContentManager: boolean;       // Has edit permissions on the document
  isPlayground: boolean;           // Site's __isPlayground flag
}
```

### Role Templates

PCC defines **5 roles** that map to the email-tier model. Gmail users (`@gmail.com`) are free-tier; all other domains are paid-tier.

```typescript
const NO_ACCESS: Role = {
  canView: false,
};

// For gmail users with edit access or admin status.
// Grants content editing but not site management.
const FREE_TIER_FULL_ACCESS: Role = {
  canView: true,
  canManageAnalytics: true,
  canManageMetadata: true,
  canManageMetadataSchema: true,
  canManageTags: true,
  canPublish: true,
  canUnpublish: true,
  canViewPublishedDocuments: true,
  canEditComponent: true,
  canEditArticle: true,
};

// For users added to a document but not in the owner's workspace.
const READ_ONLY_ACCESS: Role = {
  canView: true,
  canViewAnalytics: true,
  canViewSite: true,
  canViewMetadata: true,
  canViewMetadataSchema: true,
  canViewPublishedDocuments: false,
  canEditComponent: false,
  canEditArticle: false,
  canEditSiteURL: false,
};

// For paid-account users with edit access (non-admin).
const PAID_TIER_EDITOR: Role = {
  canView: true,
  canViewAnalytics: true,
  canManageAnalytics: false,
  canViewSite: true,
  canManageSite: false,
  canCreateSite: true,
  canDeleteSite: false,
  canManageUsers: false,
  canViewMetadata: true,
  canManageMetadata: true,
  canViewMetadataSchema: true,
  canManageMetadataSchema: false,
  canViewPublishedDocuments: true,
  canManagePublishedDocuments: false,
  canManageTags: true,
  canPublish: true,
  canUnpublish: true,
  canManageWebhook: false,
  canEditSiteURL: false,
  canEditComponent: true,
  canEditArticle: true,
};

// For paid-account users with admin status.
const PAID_TIER_ADMIN: Role = {
  canView: true,
  canViewAnalytics: true,
  canManageAnalytics: true,
  canViewSite: true,
  canManageSite: true,
  canCreateSite: true,
  canDeleteSite: true,
  canManageUsers: true,
  canViewMetadata: true,
  canManageMetadata: true,
  canViewMetadataSchema: true,
  canManageMetadataSchema: true,
  canViewPublishedDocuments: true,
  canManagePublishedDocuments: true,
  canManageTags: true,
  canPublish: true,
  canUnpublish: true,
  canManageWebhook: true,
  canEditComponent: true,
  canEditArticle: true,
  canEditSiteURL: true,
};
```

### Permission Determination Logic

**File**: `permissions.ts` — `determineAccess()`

Note the evaluation order: admin status is checked **before** document access. This means site admins can access content even without direct Google Drive permissions.

```typescript
function determineAccess(considerations: AccessConsiderations): Role {
  const { hasDocumentAccess, isGmail, hasEditAccess, isAdmin, isPlayground } =
    considerations;

  let role;

  // 1. Admins get full access (tier-dependent)
  if (isAdmin) {
    role = isGmail ? FREE_TIER_FULL_ACCESS : PAID_TIER_ADMIN;
  }
  // 2. No document access = no access at all
  else if (!hasDocumentAccess) {
    role = NO_ACCESS;
  }
  // 3. Edit access = editor role (tier-dependent)
  else if (hasEditAccess) {
    role = isGmail ? FREE_TIER_FULL_ACCESS : PAID_TIER_EDITOR;
  }
  // 4. Default to read-only
  else {
    role = READ_ONLY_ACCESS;
  }

  role = clone(role);

  // Playground sites cannot edit site URL
  if (role.canEditSiteURL && isPlayground) {
    role.canEditSiteURL = false;
  }

  // Connection permission requires both article edit + document edit access
  role.canConnectToCollection = role.canEditArticle && hasEditAccess;

  role.considerations = considerations;

  return role;
}
```

---

## Permission Checking Patterns

### Request-Scoped User Object

**Pattern**: Attach permission methods to `req.user` for clean API design

```typescript
// Type definitions
declare namespace Express {
  export interface Request {
    user: User;
    scopedJWTClaims?: unknown;
  }
}

interface User {
  email: string;
  email_verified: boolean;
  domain: string | undefined;
  articleId?: string;
  siteId?: string;
  authProvider?: 'auth0' | 'pcc' | 'google' | 'ms' | 'unknown';
  auth0Id?: string | undefined;
  isAuth0Registered?: boolean | undefined;

  // Token management
  setAccessToken(token: string): void;

  // Document-level permission checks (Google Drive or ownership-based)
  canOnlyAccessThroughSharedLink(articleId: string): Promise<boolean>;
  hasAccessToFile(articleId: string): Promise<boolean>;
  hasEditPermissions(articleId: string): Promise<boolean>;
  getFileOwner(articleId: string): Promise<string | undefined>;

  // Site-level permission checks (Firestore-backed)
  isAdminForSite(siteOrId: string | Site): Promise<boolean>;
  isCollaboratorForSite(siteOrId: string | Site): Promise<boolean>;

  // Account mapping (for Auth0 users with connected Google/MS accounts)
  getUserAccountEmails(): Promise<string[]>;
  getAccessorAccount(siteOrId: string | Site): Promise<Account | null>;
}
```

### Enhance User with Permissions

```typescript
function enhanceUserWithPermissions(
  baseUser: BaseUser,
  provider: AuthProvider,
  token: string
): User {
  const user = baseUser as User;

  // Token storage
  let accessToken = token;
  user.setAccessToken = (newToken: string) => {
    accessToken = newToken;
  };

  // Google Drive permissions
  if (provider === 'google') {
    user.hasAccessToFile = async (articleId: string) => {
      try {
        await driveClient.files.get({
          fileId: articleId,
          fields: 'id',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        return true;
      } catch {
        return false;
      }
    };

    user.hasEditPermissions = async (articleId: string) => {
      const file = await driveClient.files.get({
        fileId: articleId,
        fields: 'capabilities',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return file.data.capabilities?.canEdit === true;
    };

    user.getFileOwner = async (articleId: string) => {
      const file = await driveClient.files.get({
        fileId: articleId,
        fields: 'owners',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return file.data.owners?.[0]?.emailAddress;
    };
  }

  // Site permissions (all providers)
  user.isAdminForSite = async (siteOrId: string | Site) => {
    const site = typeof siteOrId === 'string'
      ? await fetchSite(siteOrId)
      : siteOrId;

    const admins = [
      site.originalCreator,
      ...(site.admins || []),
    ].map(e => e.toLowerCase());

    return admins.includes(user.email.toLowerCase());
  };

  user.isCollaboratorForSite = async (siteOrId: string | Site) => {
    const site = typeof siteOrId === 'string'
      ? await fetchSite(siteOrId)
      : siteOrId;

    const collaborators = (site.collaborators || [])
      .map(e => e.toLowerCase());

    return collaborators.includes(user.email.toLowerCase());
  };

  user.hasAccessToSite = async (siteOrId: string | Site) => {
    const site = typeof siteOrId === 'string'
      ? await fetchSite(siteOrId)
      : siteOrId;

    // Owner always has access
    if (site.originalCreator?.toLowerCase() === user.email.toLowerCase()) {
      return true;
    }

    // Admins and collaborators have access
    if (await user.isAdminForSite(site) ||
        await user.isCollaboratorForSite(site)) {
      return true;
    }

    // Workspace visibility grants access to same domain
    if (site.visibility === 'WORKSPACE' &&
        site.domain === user.domain) {
      return true;
    }

    return false;
  };

  return user;
}
```

### Permission Caching Pattern

```typescript
// Cache permission checks within request lifecycle
function withCache<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  cacheKey: string
): T {
  const cache = new Map<string, any>();

  return (async (...args: Parameters<T>) => {
    const key = `${cacheKey}:${JSON.stringify(args)}`;

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = await fn(...args);
    cache.set(key, result);

    return result;
  }) as T;
}

// Usage
user.hasAccessToFile = withCache(
  hasAccessToFileImpl,
  'hasAccessToFile'
);
```

---

## Account Mapping & Credential Management

### Why Account Mapping?

Auth0 users authenticate with Auth0 but may need access to Google Drive (for document permissions) or Microsoft services. PCC solves this by allowing users to **connect external accounts** after authenticating with Auth0.

### Account Data Model

**File**: `types/accounts.ts`

```typescript
interface Account {
  id: string;
  userEmail: string;        // Auth0 login email
  accountEmail: string;     // Connected provider email (e.g., Google)
  accountProvider?: string; // 'google' | 'microsoft'
  name: string;
  picture?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Accounts are stored in the `accounts` Firestore collection. A single Auth0 user can have multiple connected accounts.

### Auth0 User Permissions Class

**File**: `lib/auth0.ts`

When an Auth0 user makes a request, their permission checks must consider **all connected accounts**, not just their Auth0 email. The `Auth0UserPermissions` class handles this:

```typescript
class Auth0UserPermissions {
  private email: string;
  private accounts: Account[] | undefined;

  // Fetches all connected accounts from Firestore (cached after first call)
  async getUserAccounts(): Promise<Account[]>;

  // Returns all connected account emails
  async getUserAccountEmails(): Promise<string[]>;

  // Checks admin status using ALL connected account emails
  async isAdminForSite(siteId: string | Site): Promise<boolean>;

  // Checks collaborator status using ALL connected account emails
  async isCollaboratorForSite(siteId: string | Site): Promise<boolean>;

  // Checks site access using ALL connected account emails
  async hasAccessToSite(siteId: string): Promise<boolean>;

  // Finds which connected account has access to a given site
  async getAccessorAccount(siteId: string | Site): Promise<Account | null>;
}
```

### Credential Manager Service

**File**: `lib/credential-manager.ts`

PCC runs a separate **Credential Manager** Cloud Run service that securely stores and refreshes OAuth tokens for connected accounts. The main application communicates with it via `CredentialManagerClient`:

```typescript
type CredentialManagerProvider = 'google' | 'microsoft';

class CredentialManagerClient {
  // Store a refresh token for a connected account
  async storeCredential(params: {
    userId: string;
    accountId: string;
    refreshToken: string;
    provider: CredentialManagerProvider;
  }): Promise<{ connectionId: string }>;

  // Get a fresh access token for a connected account
  async getAccessToken(params: {
    connectionId: string;
    userId: string;
    purpose: string;
  }): Promise<{ accessToken: string; expiresAt: string }>;

  // Revoke a stored credential
  async revokeCredential(params: {
    connectionId: string;
    userId: string;
    reason: string;
  }): Promise<{ success: boolean }>;
}
```

The Credential Manager handles token refresh internally — callers simply request an access token by `connectionId` and receive a valid one.

### Auth0 Issuer Migration

The codebase supports **two Auth0 issuers simultaneously** to enable migration between Auth0 tenants or custom domains:

- `AUTH0_ISSUER_BASE_URL` — Original Auth0 issuer
- `AUTH0_NEW_ISSUER_BASE_URL` — Custom domain or new tenant issuer

Token validation checks the JWT's `iss` claim and selects the appropriate JWKS endpoint. This allows a gradual migration without breaking existing tokens.

---

## Frontend Authentication

### Dual Auth System

The `publish-builder` frontend (Next.js) supports two authentication methods simultaneously, routed by URL path:

| Path | Auth Provider | SDK | Use Case |
|---|---|---|---|
| `/dashboard/*`, `/auth/*`, `/callbacks/*` | Auth0 | `@auth0/nextjs-auth0` | Primary dashboard experience |
| `/addon/*` | Google (NextAuth) | `next-auth` | Google Workspace add-on |
| `/try/*` | Google (NextAuth) | `next-auth` | Trial/playground experience |

### Auth0 Frontend Configuration

Auth0 is connected to the frontend entirely through the `@auth0/nextjs-auth0` SDK and environment variables. There is no custom OAuth flow — the SDK provides convention-based routes (`/auth/login`, `/auth/logout`, `/auth/callback`) automatically.

**Environment variables** (from `.env.example`):

```bash
AUTH0_SECRET=              # Session encryption key (generate with: openssl rand -hex 32)
AUTH0_BASE_URL=            # This app's URL (e.g., https://publisher.pantheon.io)
AUTH0_ISSUER_BASE_URL=     # Auth0 tenant URL (e.g., https://yourapp.us.auth0.com)
AUTH0_CLIENT_ID=           # Auth0 application client ID
AUTH0_CLIENT_SECRET=       # Auth0 application client secret
AUTH0_AUDIENCE=            # API identifier (the PCC backend URL)
AUTH0_SCOPE='openid profile create:session'
```

**SDK instantiation** in `publish-builder/app/lib/auth.ts`:

```typescript
import { Auth0Client } from '@auth0/nextjs-auth0/server';

const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: process.env.AUTH0_SCOPE,
  },
  onCallback(error, context, session) {
    // Track sign-in event, check registration status
    // Redirect to /dashboard/complete-profile if new user
  },
});
```

### Login Flow

The login page (`publish-builder/app/login/clientside.tsx`) offers two paths, both routed through Auth0:

- **"Continue with Google"** → `/auth/login?connection=google-oauth2` — Auth0 skips Universal Login and redirects straight to Google OAuth
- **"Login with email"** → `/auth/login` — Auth0 shows its Universal Login page for email/password
- **"Create new account"** → `/auth/login?screen_hint=signup` — Auth0 shows its signup screen

All three paths redirect to Auth0's hosted login, which handles the OAuth/OIDC flow and redirects back to `/auth/callback`. The SDK processes the callback, stores the session (with tokens) in an encrypted cookie, and the `onCallback` handler checks whether the user needs to complete registration.

### Auth0 Custom Claims

Auth0 injects PCC-specific data into the JWT via a custom namespace (`pcc`), configured in Auth0 Actions or Rules on the Auth0 tenant side:

```typescript
// In the Auth0 token payload:
{
  "pcc": {
    "email": "user@example.com",
    "is_registered": true
  },
  "sub": "auth0|abc123",
  "iss": "https://yourapp.us.auth0.com/",
  // ...standard JWT claims
}
```

The middleware checks `is_registered` to determine whether to redirect new users to the profile completion page.

### Session Management & Token Refresh

The Next.js middleware (`publish-builder/proxy.ts`) handles Auth0 session management on every `/dashboard/*` request:

1. `auth0.middleware(req)` — handles Auth0 route conventions (`/auth/*`)
2. `auth0.getSession(req)` — reads the encrypted session cookie
3. If the access token expires within 5 minutes, `auth0.getAccessToken(req, resp, { refresh: true })` uses the stored refresh token to get a new one from Auth0
4. If the session is invalid or the token cannot be refreshed, the user is redirected to `/login`

### Path-Based Provider Routing

The Next.js middleware sets an `x-auth-provider` header on each response, which the `AuthContextProvider` server component reads to decide which session to load:

**File**: `publish-builder/proxy.ts`

```typescript
// Middleware sets the provider header based on path
if (req.nextUrl.pathname.startsWith('/addon/')) {
  resp.headers.set('x-auth-provider', 'next-auth');
} else if (req.nextUrl.pathname.startsWith('/dashboard/')) {
  resp.headers.set('x-auth-provider', 'auth0');
}
```

**File**: `publish-builder/app/components/auth/AuthContextProvider.tsx`

```typescript
// Server component reads the header to select the session source
const provider = (headersList.get('x-auth-provider') as AuthProvider) || '';
if (provider === AuthProvider.nextAuth) return getNextAuthSession();
else return await getAuth0Session();
```

### NextAuth (Google OAuth) Configuration

For `/addon/*` and `/try/*` paths, NextAuth.js handles Google OAuth directly (not through Auth0):

**File**: `publish-builder/app/api/auth/[...nextauth]/auth-options.ts`

```typescript
GoogleProvider({
  clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  authorization: {
    params: {
      access_type: 'offline',  // Request refresh token
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive.file',
      ].join(' '),
    },
  },
})
```

NextAuth stores Google's `access_token`, `refresh_token`, and `id_token` in the JWT session cookie and handles token refresh via Google's OAuth2 endpoint.

### How Tokens Reach the Backend

The two providers send different tokens to the PCC backend:

- **Auth0 users** (`/dashboard`): Send the Auth0 JWT as `Authorization: Bearer <auth0_jwt>`. For Google Drive access, the backend's `populateAccountToken` middleware uses the Credential Manager to fetch an OAuth token from the user's connected account.
- **Google/NextAuth users** (`/addon`, `/try`): Send the Google ID token as `Authorization: Bearer <google_id_token>` and pass the Google OAuth access token as the `oauth-token` header. The backend uses that OAuth token directly for Drive API calls.

---

## Implementation Guide

### Step 1: Set Up Token Validation

```typescript
// 1. Install dependencies
// npm install express-oauth2-jwt-bearer google-auth-library jsonwebtoken jwks-rsa

// 2. Create token validators
import { auth } from 'express-oauth2-jwt-bearer';
import { OAuth2Client } from 'google-auth-library';

// Auth0 validator
const auth0Validator = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: 'RS256',
});

// Google validator
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

async function validateGoogleToken(token: string) {
  const ticket = await googleClient.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
}
```

### Step 2: Create Auth Middleware

```typescript
// middleware/auth.ts
export function requireAuth(options?: AuthOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    try {
      // Detect and validate token
      const provider = detectProvider(token);
      let user;

      switch (provider) {
        case 'auth0':
          user = await validateAuth0Token(token);
          break;
        case 'google':
          user = await validateGoogleToken(token);
          break;
        default:
          throw new Error('Unknown provider');
      }

      // Enhance with permissions
      req.user = enhanceUserWithPermissions(user, provider, token);

      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}
```

### Step 3: Define Roles and Permissions

```typescript
// types/permissions.ts
export interface Role {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
}

export const ROLES = {
  VIEWER: {
    canView: true,
    canEdit: false,
    canDelete: false,
    canManageUsers: false,
    canManageSettings: false,
  },
  EDITOR: {
    canView: true,
    canEdit: true,
    canDelete: false,
    canManageUsers: false,
    canManageSettings: false,
  },
  ADMIN: {
    canView: true,
    canEdit: true,
    canDelete: true,
    canManageUsers: true,
    canManageSettings: true,
  },
} as const;
```

### Step 4: Implement Permission Checks

```typescript
// services/permissions.ts
export async function getUserRole(
  userId: string,
  resourceId: string
): Promise<Role> {
  // Fetch user-resource relationship from database
  const membership = await db.collection('memberships')
    .where('userId', '==', userId)
    .where('resourceId', '==', resourceId)
    .get();

  if (membership.empty) {
    return ROLES.VIEWER;
  }

  const role = membership.docs[0].data().role;
  return ROLES[role] || ROLES.VIEWER;
}

export function requirePermission(permission: keyof Role) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const resourceId = req.params.id;
    const role = await getUserRole(req.user.email, resourceId);

    if (!role[permission]) {
      return res.status(403).json({
        error: `Missing permission: ${permission}`
      });
    }

    req.userRole = role;
    next();
  };
}
```

### Step 5: Apply to Routes

```typescript
// routes/resources.ts
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../services/permissions';

router.get('/resources/:id',
  requireAuth(),
  requirePermission('canView'),
  async (req, res) => {
    // Handler logic
  }
);

router.put('/resources/:id',
  requireAuth(),
  requirePermission('canEdit'),
  async (req, res) => {
    // Handler logic
  }
);

router.delete('/resources/:id',
  requireAuth(),
  requirePermission('canDelete'),
  async (req, res) => {
    // Handler logic
  }
);

router.post('/resources/:id/users',
  requireAuth(),
  requirePermission('canManageUsers'),
  async (req, res) => {
    // Handler logic
  }
);
```

### Step 6: Database Schema

```typescript
// Firestore collections structure

// users
{
  email: string;
  displayName: string;
  domain: string;
  authProvider: 'auth0' | 'google' | 'ms';
  createdAt: Timestamp;
}

// resources
{
  id: string;
  name: string;
  ownerId: string;              // User email
  domain: string;               // Workspace domain
  visibility: 'PRIVATE' | 'WORKSPACE';
  createdAt: Timestamp;
}

// memberships
{
  userId: string;               // User email
  resourceId: string;
  role: 'VIEWER' | 'EDITOR' | 'ADMIN';
  grantedBy: string;            // Who added them
  createdAt: Timestamp;
}

// apikeys (if using API keys)
{
  keyHash: string;              // SHA256 hash
  userId: string;
  keyType: string;
  lastUsedAt: Timestamp;
  createdAt: Timestamp;
}
```

---

## Best Practices

### 1. Security

- **Never store unhashed API keys**: Always hash with SHA256 before storage
- **Use RS256 for JWTs**: Asymmetric signing prevents token forgery
- **Validate all token fields**: Check issuer, audience, expiration, algorithm
- **Implement token rotation**: Refresh tokens regularly
- **Rate limit auth endpoints**: Prevent brute force attacks

### 2. Performance

- **Cache permission checks**: Within request lifecycle to avoid repeated DB queries
- **Lazy load permissions**: Only check permissions when needed
- **Batch permission checks**: Fetch multiple memberships in single query
- **Index database fields**: email, resourceId, keyHash for fast lookups

### 3. User Experience

- **Clear error messages**: "Missing permission: canEdit" vs "Access denied"
- **Graceful degradation**: Show UI with disabled actions vs hiding entirely
- **Consistent naming**: Use same terminology across API and UI

### 4. Maintainability

- **Centralize permission logic**: Single source of truth for role definitions
- **Use TypeScript**: Catch permission typos at compile time
- **Document roles**: Clear explanation of what each role can do
- **Version your roles**: Track changes to permission models

### 5. Flexibility

- **Make roles configurable**: Allow customization per tenant
- **Support custom permissions**: Beyond predefined roles
- **Plan for multi-tenancy**: Domain-based isolation from day one

---

## Code Examples

### Example 1: Domain-Based Access

```typescript
// Automatic access for users in same workspace
async function hasWorkspaceAccess(
  userEmail: string,
  resource: Resource
): Promise<boolean> {
  // Extract domain from email
  const userDomain = userEmail.split('@')[1];

  // Check if resource allows workspace access
  if (resource.visibility === 'WORKSPACE' &&
      resource.domain === userDomain) {
    return true;
  }

  return false;
}
```

### Example 2: Hybrid Permission Model

```typescript
// Combine external (Google Drive) and internal (database) permissions
async function getUserCapabilities(
  user: User,
  articleId: string,
  siteId: string
): Promise<Role> {
  // 1. Check external system (Google Drive)
  const hasDriveAccess = await user.hasAccessToFile(articleId);
  const canEditInDrive = await user.hasEditPermissions(articleId);

  // 2. Check internal system (site membership)
  const isAdmin = await user.isAdminForSite(siteId);
  const isCollaborator = await user.isCollaboratorForSite(siteId);

  // 3. Combine permissions
  const considerations = {
    hasDocumentAccess: hasDriveAccess,
    hasEditAccess: canEditInDrive,
    isAdmin,
    isContentManager: isCollaborator,
    isGmail: user.domain === 'gmail.com',
    isPaidAccount: user.domain !== 'gmail.com',
  };

  // 4. Determine role
  return determineRole(considerations);
}
```

### Example 3: Scoped Tokens for Previews

```typescript
// Generate limited-purpose token for public preview
router.post('/articles/:id/preview-token',
  requireAuth(),
  requirePermission('canView'),
  async (req, res) => {
    const { id } = req.params;

    // Generate 6-hour token for preview access only
    const previewToken = generateScopedJWT('preview_grant', {
      sub: req.user.email,
      articleId: id,
      isStatic: true,
    }, '6h');

    res.json({
      previewUrl: `${process.env.PREVIEW_URL}?token=${previewToken}`,
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
  }
);

// Preview endpoint accepts scoped token
router.get('/preview',
  requireAuth({ scope: 'preview_grant' }),
  async (req, res) => {
    const { articleId } = req.scopedJWTClaims as { articleId: string };

    // Render preview (no edit permissions needed)
    const article = await fetchArticle(articleId);
    res.render('preview', { article });
  }
);
```

### Example 4: Account Mapping (Auth0 to Google)

```typescript
// Allow Auth0 users to connect Google workspace accounts
router.post('/accounts/connect',
  requireAuth({ allowedProviders: ['auth0'] }),
  async (req, res) => {
    const { googleAccessToken } = req.body;

    // Validate Google token
    const googleUser = await validateGoogleToken(googleAccessToken);

    // Store account mapping
    await db.collection('accounts').add({
      auth0UserId: req.user.auth0Id,
      auth0Email: req.user.email,
      googleEmail: googleUser.email,
      googleDomain: googleUser.hd,
      accessToken: encryptToken(googleAccessToken),
      refreshToken: encryptToken(req.body.googleRefreshToken),
      createdAt: new Date(),
    });

    res.json({ success: true });
  }
);

// Use connected account for Drive operations
async function populateGoogleToken(req: Request) {
  if (req.user.authProvider !== 'auth0') {
    return; // Already has Google token
  }

  // Fetch connected Google account
  const account = await db.collection('accounts')
    .where('auth0UserId', '==', req.user.auth0Id)
    .get();

  if (!account.empty) {
    const googleToken = decryptToken(account.docs[0].data().accessToken);
    req.user.setAccessToken(googleToken);
  }
}
```

### Example 5: Permission-Based UI Rendering

```typescript
// API endpoint returns user's capabilities
router.get('/articles/:id/capabilities',
  requireAuth(),
  async (req, res) => {
    const { id } = req.params;
    const siteId = await getSiteIdForArticle(id);

    const role = await getUserCapabilities(req.user, id, siteId);

    res.json({
      canView: role.canView,
      canEdit: role.canEditArticle,
      canPublish: role.canPublish,
      canDelete: role.canDelete,
      canManageUsers: role.canManageUsers,
    });
  }
);

// Frontend conditionally renders UI
function ArticleToolbar({ capabilities }: { capabilities: Role }) {
  return (
    <div className="toolbar">
      {capabilities.canEdit && (
        <button onClick={handleEdit}>Edit</button>
      )}
      {capabilities.canPublish && (
        <button onClick={handlePublish}>Publish</button>
      )}
      {capabilities.canDelete && (
        <button onClick={handleDelete}>Delete</button>
      )}
      {capabilities.canManageUsers && (
        <button onClick={handleShare}>Share</button>
      )}
    </div>
  );
}
```

---

## Summary

Pantheon Content Publisher's authentication architecture demonstrates:

1. **Self-Contained AuthZ**: All authorization is internal (Firestore-backed) — no dependency on Pantheon's MAS or any external authorization service
2. **Flexible AuthN**: Multiple auth providers (Auth0, Google, Microsoft) for authentication only
3. **Performance**: Lazy permission evaluation with request-scoped caching
4. **Security**: Proper token validation, hashed API keys, scoped access, separate credential management service
5. **Usability**: Clean API design with permissions attached to `req.user`
6. **Scalability**: Domain-based access for automatic workspace collaboration
7. **Cross-Provider Access**: Account mapping system allows Auth0 users to connect Google/Microsoft accounts for Drive access

Key takeaways for implementation:

- PCC uses external providers for authN only; all authZ is internal
- Start with one provider, design for multiple
- Attach permission methods to user object for clean APIs
- Cache permission checks within request lifecycle
- Use scoped tokens for limited-purpose operations
- Combine external permissions (Drive) with internal authorization (Firestore)
- Store only hashed secrets (API keys, tokens)
- Use a separate credential management service for OAuth refresh tokens
- Support account mapping for cross-provider access (Auth0 → Google)
- Email domain determines tier (gmail.com = free, all others = paid)

---

## Reference Files

From Pantheon Content Publisher codebase:

**Authentication Core**:
- `/packages/functions/src/middleware/auth/index.ts` - Main auth middleware
- `/packages/functions/src/lib/auth0-token.ts` - Auth0 validation
- `/packages/functions/src/middleware/auth/microsoft.ts` - Microsoft validation
- `/packages/functions/src/middleware/auth/pcc-token.ts` - API key & collection token validation
- `/packages/functions/src/lib/jwt.ts` - Scoped JWT utilities

**Authorization Core** (all internal, Firestore-backed):
- `/packages/functions/src/permissions.ts` - Role definitions and determination logic
- `/packages/functions/src/custom.d.ts` - User type definitions
- `/packages/functions/src/types/site.ts` - Site and membership types

**Account Mapping & Credential Management**:
- `/packages/functions/src/lib/auth0.ts` - Auth0UserPermissions class (cross-account permission checks)
- `/packages/functions/src/lib/credential-manager.ts` - CredentialManagerClient SDK
- `/packages/functions/src/types/accounts.ts` - Account type definition
- `/cloudrun/credential-manager/` - Credential Manager Cloud Run service
- `/cloudrun/addonapi/src/modules/accounts/index.ts` - Account lifecycle management

**Frontend Auth**:
- `/publish-builder/app/lib/auth.ts` - Auth0Client instantiation, session helpers (`getAuth0Session`, `getNextAuthSession`)
- `/publish-builder/app/lib/auth0.ts` - Auth0 user profile and userinfo fetching
- `/publish-builder/app/api/auth/[...nextauth]/auth-options.ts` - NextAuth setup (Google OAuth)
- `/publish-builder/proxy.ts` - Next.js middleware (path-based provider routing, Auth0 session/token refresh)
- `/publish-builder/app/login/clientside.tsx` - Login page UI (Auth0 Universal Login + Google connection)
- `/publish-builder/app/components/auth/AuthContextProvider.tsx` - Server component that selects session by `x-auth-provider` header
- `/publish-builder/app/components/auth/hooks.ts` - `useAuthContext` hook with provider-aware `getGoogleAccessToken`
- `/publish-builder/.env.example` - Auth0 and Google OAuth environment variables
