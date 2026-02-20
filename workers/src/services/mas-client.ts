/**
 * MAS (Membership Authorization Service) REST Client
 *
 * Fetches user-site memberships from Pantheon's centralized authorization service.
 * Supports GCP IAM identity token authentication for Cloud Run load balancer.
 *
 * @see mas-integration-guide.md
 */

import type { PantheonRole } from '../types';

/**
 * Configuration for the MAS client.
 */
export interface MASClientConfig {
  /** Base URL of the MAS service (e.g., https://memberships.svc.pantheon.io) */
  baseUrl: string;
  /** GCP service account key JSON string for IAM authentication */
  gcpServiceAccountKey?: string;
  /** TTL in seconds for cached MAS role data (default: 300) */
  cacheTtlSeconds?: number;
}

/**
 * Membership entry from MAS API response.
 */
interface MASMembershipEntry {
  user_id: string;
  role: string;
}

/**
 * MAS API paginated response shape.
 */
interface MASResponse {
  data: MASMembershipEntry[];
  page_info?: {
    has_next_page: boolean;
    next_page_token?: string;
  };
}

/**
 * Parsed GCP service account key.
 */
interface GCPServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

/**
 * Cached identity token with expiry tracking.
 */
interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Converts a base64url string to an ArrayBuffer.
 */
function base64urlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (const [i] of bytes.entries()) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Encodes an ArrayBuffer to base64url.
 */
function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encodes a string to base64url.
 */
function stringToBase64url(str: string): string {
  const encoder = new TextEncoder();
  return arrayBufferToBase64url(encoder.encode(str).buffer);
}

/**
 * Imports a PEM-encoded RSA private key for signing.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\n/g, '')
    .replace(/\r/g, '')
    .replace(/\s/g, '');

  const binaryDer = base64urlToArrayBuffer(
    pemBody.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  );

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * MAS REST client for fetching user-site memberships.
 *
 * Handles:
 * - GCP IAM identity token generation (self-signed JWT -> identity token exchange)
 * - Pagination of MAS API responses
 * - Graceful degradation (returns null on failure)
 */
export class MASClient {
  private readonly baseUrl: string;
  private readonly gcpKey: GCPServiceAccountKey | null;
  readonly cacheTtlSeconds: number;
  private cachedToken: CachedToken | null = null;

  constructor(config: MASClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? 300;

    if (config.gcpServiceAccountKey !== undefined && config.gcpServiceAccountKey !== '') {
      try {
        this.gcpKey = JSON.parse(config.gcpServiceAccountKey) as GCPServiceAccountKey;
      } catch {
        console.error('MASClient: Failed to parse GCP service account key');
        this.gcpKey = null;
      }
    } else {
      this.gcpKey = null;
    }
  }

  /**
   * Gets the role for a specific user on a specific site.
   * Returns null if the user has no membership or on any error.
   */
  async getUserSiteRole(userId: string, siteId: string): Promise<PantheonRole | null> {
    try {
      const memberships = await this.fetchAllMemberships(siteId);
      if (memberships === null) return null;

      const entry = memberships.find((m) => m.user_id === userId);
      if (entry === undefined) return null;

      return this.mapMASRole(entry.role);
    } catch (error) {
      console.error('MASClient: Error fetching user site role:', error);
      return null;
    }
  }

  /**
   * Gets all memberships for a site.
   * Returns null on any error.
   */
  async getSiteMemberships(
    siteId: string,
  ): Promise<{ userId: string; role: PantheonRole }[] | null> {
    try {
      const memberships = await this.fetchAllMemberships(siteId);
      if (memberships === null) return null;

      return memberships
        .map((m) => {
          const role = this.mapMASRole(m.role);
          if (role === null) return null;
          return { userId: m.user_id, role };
        })
        .filter((m): m is { userId: string; role: PantheonRole } => m !== null);
    } catch (error) {
      console.error('MASClient: Error fetching site memberships:', error);
      return null;
    }
  }

  /**
   * Fetches all membership pages for a site with pagination handling.
   */
  private async fetchAllMemberships(siteId: string): Promise<MASMembershipEntry[] | null> {
    const allEntries: MASMembershipEntry[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${this.baseUrl}/site/${siteId}/memberships/user`);
      url.searchParams.set('inherited', 'true');
      if (pageToken !== undefined) {
        url.searchParams.set('page_token', pageToken);
      }

      const token = await this.getIdentityToken();
      if (token === null) return null;

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error(`MASClient: HTTP ${String(response.status)} from MAS for site ${siteId}`);
        return null;
      }

      const body: MASResponse = await response.json();
      allEntries.push(...body.data);

      pageToken = body.page_info?.has_next_page === true
        ? body.page_info.next_page_token
        : undefined;
    } while (pageToken !== undefined);

    return allEntries;
  }

  /**
   * Gets a GCP identity token, using cache when available.
   * Creates a self-signed JWT and exchanges it for an identity token.
   */
  private async getIdentityToken(): Promise<string | null> {
    // Return cached token if still valid (with 60s buffer)
    if (this.cachedToken !== null && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.token;
    }

    if (this.gcpKey === null) {
      console.error('MASClient: No GCP service account key configured');
      return null;
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600; // 1 hour

      // Create self-signed JWT
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        iss: this.gcpKey.client_email,
        sub: this.gcpKey.client_email,
        aud: 'https://www.googleapis.com/oauth2/v4/token',
        iat: now,
        exp,
        target_audience: 'membership-authorization-api',
      };

      const headerB64 = stringToBase64url(JSON.stringify(header));
      const payloadB64 = stringToBase64url(JSON.stringify(payload));
      const signingInput = `${headerB64}.${payloadB64}`;

      const privateKey = await importPrivateKey(this.gcpKey.private_key);
      const encoder = new TextEncoder();
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        privateKey,
        encoder.encode(signingInput),
      );

      const signatureB64 = arrayBufferToBase64url(signature);
      const selfSignedJwt = `${signingInput}.${signatureB64}`;

      // Exchange for identity token
      const tokenResponse = await fetch('https://www.googleapis.com/oauth2/v4/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: selfSignedJwt,
        }),
      });

      if (!tokenResponse.ok) {
        console.error(
          `MASClient: Token exchange failed with status ${String(tokenResponse.status)}`,
        );
        return null;
      }

      const tokenData: { id_token?: string } = await tokenResponse.json();
      if (tokenData.id_token === undefined || tokenData.id_token === '') {
        console.error('MASClient: No id_token in token exchange response');
        return null;
      }

      // Cache the token (expires in ~1 hour, we refresh at 60s before expiry)
      this.cachedToken = {
        token: tokenData.id_token,
        expiresAt: Date.now() + 3500_000, // ~58 minutes
      };

      return tokenData.id_token;
    } catch (error) {
      console.error('MASClient: Error generating identity token:', error);
      return null;
    }
  }

  /**
   * Maps MAS role strings to PantheonRole type.
   */
  private mapMASRole(masRole: string): PantheonRole | null {
    switch (masRole) {
      case 'admin':
        return 'admin';
      case 'team_member':
        return 'team_member';
      case 'developer':
        return 'developer';
      case 'unprivileged':
        return 'team_member'; // Map unprivileged to lowest named role
      default:
        return null;
    }
  }
}
