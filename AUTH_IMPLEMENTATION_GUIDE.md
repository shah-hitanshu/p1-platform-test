# Authentication & Authorization Implementation Guide

> Based on Pantheon Content Publisher's authentication architecture

This guide documents the authentication and authorization patterns used in Pantheon Content Publisher and provides guidance for implementing similar systems in other applications.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Multi-Provider Authentication Strategy](#multi-provider-authentication-strategy)
3. [Token Management](#token-management)
4. [Authorization & Role System](#authorization--role-system)
5. [Permission Checking Patterns](#permission-checking-patterns)
6. [Implementation Guide](#implementation-guide)
7. [Best Practices](#best-practices)
8. [Code Examples](#code-examples)

---

## Architecture Overview

Content Publisher implements a **multi-provider authentication system** with **flexible, role-based authorization** that operates without external dependencies for permission checking.

### Key Architectural Decisions

1. **Multiple Authentication Providers**: Support Auth0, Google OAuth, Microsoft/Azure AD, and custom scoped tokens
2. **Lazy Permission Evaluation**: Permissions computed on-demand with request-scoped caching
3. **Domain-Based Access Control**: Workspace domains provide automatic collaboration within organizations
4. **Hybrid Permission Model**: Combines external system permissions (Google Drive) with internal authorization (Firestore)
5. **Request-Scoped User Object**: All permission methods attached to `req.user` for clean API design

### High-Level Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ Bearer Token
       ▼
┌─────────────────────┐
│  Token Validation   │
│  - Auth0 JWT        │
│  - Google ID Token  │
│  - Microsoft Token  │
│  - Scoped PCC Token │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Populate req.user  │
│  + permission fns   │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Route Handler      │
│  - Check access     │
│  - Determine role   │
│  - Enforce policy   │
└─────────────────────┘
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

**Challenge**: Support multiple Auth0 issuers during migration

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

```typescript
type AccessConsiderations = {
  // Document-level access
  hasDocumentAccess: boolean;      // Via Google Drive or ownership
  isOwner: boolean;                // File/resource owner
  hasEditAccess: boolean;          // Can modify content

  // Organization-level access
  isGmail: boolean;                // Free tier (@gmail.com)
  isPaidAccount: boolean;          // Paid tier (non-gmail)
  isSameWorkspace: boolean;        // Same email domain

  // Site-level access
  isAdmin: boolean;                // Site administrator
  isContentManager: boolean;       // Content permissions
  isPlayground: boolean;           // Sandbox environment
};
```

### Role Templates

```typescript
const NO_ACCESS: Role = {
  canView: false,
};

const READ_ONLY_ACCESS: Role = {
  canView: true,
  canViewAnalytics: true,
  canViewSite: true,
  canViewMetadata: true,
  canViewPublishedDocuments: true,
  // All other permissions default to false
};

const EDITOR: Role = {
  canView: true,
  canViewAnalytics: true,
  canManageAnalytics: true,
  canViewSite: true,
  canCreateSite: true,
  canEditComponent: true,
  canEditArticle: true,
  canViewMetadata: true,
  canManageMetadata: true,
  canViewPublishedDocuments: true,
  canManagePublishedDocuments: true,
  canManageTags: true,
  canPublish: true,
  canUnpublish: true,
};

const ADMIN: Role = {
  ...EDITOR,
  canManageSite: true,
  canDeleteSite: true,
  canEditSiteURL: true,
  canManageUsers: true,
  canViewMetadataSchema: true,
  canManageMetadataSchema: true,
  canManageWebhook: true,
};
```

### Permission Determination Logic

```typescript
function determineRole(considerations: AccessConsiderations): Role {
  const {
    hasDocumentAccess,
    isGmail,
    isPaidAccount,
    isAdmin,
    hasEditAccess,
    isPlayground,
  } = considerations;

  // No document access = no access at all
  if (!hasDocumentAccess) {
    return NO_ACCESS;
  }

  // Admins get full access (tier-dependent)
  if (isAdmin) {
    return isPaidAccount ? ADMIN : EDITOR;
  }

  // Editors get edit permissions (tier-dependent)
  if (hasEditAccess) {
    return isPaidAccount ? EDITOR : EDITOR;
  }

  // Default to read-only
  const role = { ...READ_ONLY_ACCESS };

  // Apply restrictions
  if (isPlayground) {
    role.canEditSiteURL = false;
  }

  // Connection permission requires edit access
  role.canConnectToCollection = hasEditAccess;

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
  authProvider: AuthProvider;

  // Permission checking methods
  hasAccessToFile(articleId: string): Promise<boolean>;
  hasEditPermissions(articleId: string): Promise<boolean>;
  getFileOwner(articleId: string): Promise<string | undefined>;
  isAdminForSite(siteOrId: string | Site): Promise<boolean>;
  isCollaboratorForSite(siteOrId: string | Site): Promise<boolean>;
  hasAccessToSite(siteOrId: string | Site): Promise<boolean>;

  // Token management
  setAccessToken(token: string): void;
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

1. **Flexibility**: Support multiple auth providers without architectural lock-in
2. **Performance**: Lazy permission evaluation with request-scoped caching
3. **Security**: Proper token validation, hashed API keys, scoped access
4. **Usability**: Clean API design with permissions attached to `req.user`
5. **Scalability**: Domain-based access for automatic workspace collaboration

Key takeaways for implementation:

- Start with one provider, design for multiple
- Attach permission methods to user object for clean APIs
- Cache permission checks within request lifecycle
- Use scoped tokens for limited-purpose operations
- Combine external permissions (Drive) with internal authorization (DB)
- Store only hashed secrets (API keys, tokens)
- Make roles configurable and document them clearly

---

## Reference Files

From Pantheon Content Publisher codebase:

**Authentication Core**:
- `/packages/functions/src/middleware/auth/index.ts` - Main auth middleware
- `/packages/functions/src/lib/auth0-token.ts` - Auth0 validation
- `/packages/functions/src/middleware/auth/microsoft.ts` - Microsoft validation
- `/packages/functions/src/lib/jwt.ts` - Scoped JWT utilities

**Authorization Core**:
- `/packages/functions/src/permissions.ts` - Role definitions and logic
- `/packages/functions/src/custom.d.ts` - User type definitions
- `/packages/functions/src/types/site.ts` - Site and membership types

**Frontend Auth**:
- `/publish-builder/app/api/auth/[...nextauth]/auth-options.ts` - NextAuth setup
- `/publish-builder/app/lib/auth.ts` - Client auth utilities
