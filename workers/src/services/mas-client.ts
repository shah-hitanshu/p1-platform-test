/**
 * MAS (Membership Authorization Service) REST Client
 *
 * Fetches user-site memberships from Pantheon's centralized authorization service.
 * Supports GCP IAM identity token authentication for Cloud Run load balancer.
 *
 * @see mas-integration-guide.md
 */

import type { PantheonRole } from '../types';
import { getGcpIdentityToken } from './gcp-auth.js';

export interface MASClientConfig {
  baseUrl: string;
  gcpServiceAccountKey?: string;
  cacheTtlSeconds?: number;
}

interface MASMembershipEntry {
  user_id: string;
  role: string;
}

interface MASResponse {
  data: MASMembershipEntry[];
  page_info?: {
    has_next_page: boolean;
    next_page_token?: string;
  };
}

export class MASClient {
  private readonly baseUrl: string;
  private readonly gcpServiceAccountKey: string | null;
  readonly cacheTtlSeconds: number;

  constructor(config: MASClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? 300;
    this.gcpServiceAccountKey =
      config.gcpServiceAccountKey !== undefined && config.gcpServiceAccountKey !== ''
        ? config.gcpServiceAccountKey
        : null;
  }

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

  private async getIdentityToken(): Promise<string | null> {
    if (this.gcpServiceAccountKey === null) {
      console.error('MASClient: No GCP service account key configured');
      return null;
    }

    try {
      return await getGcpIdentityToken(
        this.gcpServiceAccountKey,
        'membership-authorization-api',
      );
    } catch (error) {
      console.error('MASClient: Error generating identity token:', error);
      return null;
    }
  }

  private mapMASRole(masRole: string): PantheonRole | null {
    switch (masRole) {
      case 'admin':
        return 'admin';
      case 'team_member':
        return 'team_member';
      case 'developer':
        return 'developer';
      case 'unprivileged':
        return 'team_member';
      default:
        return null;
    }
  }
}
