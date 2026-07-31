/**
 * Broker Transaction Durable Object
 *
 * Manages short-lived OAuth login transactions with strong consistency.
 * Each transaction gets its own DO instance, eliminating eventual consistency issues.
 *
 * Lifecycle:
 * - Created when a panel initiates login (via sat_ token)
 * - Approved when user authenticates via Auth0
 * - Redeemed when panel exchanges transaction for broker JWT
 * - Auto-deleted after 5 minutes via alarm
 */

import { DurableObject } from 'cloudflare:workers';
// DurableObjectState comes from the ambient @cloudflare/workers-types globals
// (tsconfig "types"). Do NOT import it from '@cloudflare/workers-types': the
// package ships no "types" entry, so a value/type import resolves to its
// 15k-line index.ts source — a duplicate of the entire Workers type universe
// that tsserver must structurally compare against the ambient globals, hanging
// type checking for minutes.
import {
  MAX_ACTOR_ID_LENGTH,
  MAX_REASON_LENGTH,
  MAX_SITE_ID_LENGTH,
} from '../constants/security-limits';

// =============================================================================
// Constants
// =============================================================================

const TRANSACTION_TTL_MS = 300_000; // 5 minutes
const TRANSACTION_STORAGE_KEY = 'transaction';

/** Maximum length for transaction/token IDs (UUIDs are 36 chars) */
const MAX_TX_ID_LENGTH = 64;

/** Maximum length for email addresses */
const MAX_EMAIL_LENGTH = 320; // RFC 5321 standard

/** Maximum length for user display names */
const MAX_NAME_LENGTH = 256;

/** Maximum length for redirect URLs */
const MAX_URL_LENGTH = 2048;

/** Maximum length for OAuth prompt parameter */
const MAX_PROMPT_LENGTH = 32;

// =============================================================================
// Types
// =============================================================================

export interface LoginTransaction {
  id: string;
  siteId: string;
  siteApiTokenId: string;
  status: 'pending' | 'approved' | 'redeemed';
  createdAt: number;
  expiresAt: number;
  userId?: string;
  userEmail?: string;
  userName?: string;
  redirectUrl?: string;
  prompt?: string;
}

export interface ApproveUserInfo {
  userId: string;
  userEmail: string;
  userName?: string;
}

interface BrokerTransactionEnv {}

// =============================================================================
// BrokerTransaction Durable Object
// =============================================================================

export class BrokerTransaction extends DurableObject<BrokerTransactionEnv> {
  /** Alias ctx as state for consistency with other DOs */
  private get state(): DurableObjectState {
    return this.ctx;
  }

  private transaction: LoginTransaction | null = null;
  private initialized = false;

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Lazy initialization - loads transaction from storage on first access.
   * Follows the pattern established by DocumentSession and PresenceManager.
   */
  private async initializeIfNeeded(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const stored = await this.state.storage.get<LoginTransaction>(TRANSACTION_STORAGE_KEY);
      if (stored !== undefined && stored !== null && typeof stored === 'object') {
        this.transaction = stored;
      }
    } catch (error) {
      console.warn('[BrokerTransaction] Failed to restore from storage:', error);
    }

    this.initialized = true;
  }

  // ===========================================================================
  // Input Validation
  // ===========================================================================

  /**
   * Validates string field lengths to prevent DoS attacks.
   * Throws Error if any field exceeds its maximum length.
   */
  private validateFields(fields: Record<string, string | undefined>): void {
    const limits: Record<string, number> = {
      txId: MAX_TX_ID_LENGTH,
      siteId: MAX_SITE_ID_LENGTH,
      siteApiTokenId: MAX_TX_ID_LENGTH,
      userId: MAX_ACTOR_ID_LENGTH,
      userEmail: MAX_EMAIL_LENGTH,
      userName: MAX_NAME_LENGTH,
      redirectUrl: MAX_URL_LENGTH,
      prompt: MAX_PROMPT_LENGTH,
    };

    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined || value === null) {
        continue;
      }
      const limit = limits[name] ?? MAX_REASON_LENGTH; // default limit
      if (value.length > limit) {
        throw new Error(`${name} exceeds maximum length of ${limit}`);
      }
    }
  }

  // ===========================================================================
  // HTTP RPC Handler
  // ===========================================================================

  /**
   * HTTP-style RPC handler for DO method calls.
   * Routes to create/get/approve/redeem based on URL path.
   */
  async fetch(request: Request): Promise<Response> {
    await this.initializeIfNeeded();

    const url = new URL(request.url);
    const method = url.pathname.slice(1); // Remove leading /

    try {
      if (method === 'create' && request.method === 'POST') {
        const body: {
          txId: string;
          siteId: string;
          siteApiTokenId: string;
          options?: { redirectUrl?: string; prompt?: string };
        } = await request.json();
        const tx = await this.create(body.txId, body.siteId, body.siteApiTokenId, body.options);
        return new Response(JSON.stringify(tx), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'get' && request.method === 'GET') {
        const tx = await this.get();
        return new Response(JSON.stringify(tx), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'approve' && request.method === 'POST') {
        const userInfo: ApproveUserInfo = await request.json();
        const tx = await this.approve(userInfo);
        return new Response(JSON.stringify(tx), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'redeem' && request.method === 'POST') {
        const tx = await this.redeem();
        return new Response(JSON.stringify(tx), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Method not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('BrokerTransactionDO fetch error', err);

      // Return specific validation errors (safe to expose)
      // but hide internal errors and stack traces
      let errorMessage = 'Internal server error';
      if (err instanceof Error && err.message.includes('exceeds maximum length')) {
        errorMessage = err.message;
      }

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ===========================================================================
  // Public Transaction Methods
  // ===========================================================================

  /**
   * Creates a new pending transaction.
   * Validates all input fields and sets auto-cleanup alarm.
   */
  async create(
    txId: string,
    siteId: string,
    siteApiTokenId: string,
    options?: { redirectUrl?: string; prompt?: string },
  ): Promise<LoginTransaction> {
    // Validate all inputs
    this.validateFields({
      txId,
      siteId,
      siteApiTokenId,
      redirectUrl: options?.redirectUrl,
      prompt: options?.prompt,
    });
    const now = Math.floor(Date.now() / 1000);

    this.transaction = {
      id: txId,
      siteId,
      siteApiTokenId,
      status: 'pending',
      createdAt: now,
      expiresAt: now + Math.floor(TRANSACTION_TTL_MS / 1000),
      ...(options?.redirectUrl !== undefined ? { redirectUrl: options.redirectUrl } : {}),
      ...(options?.prompt !== undefined ? { prompt: options.prompt } : {}),
    };

    // Persist to durable storage
    await this.state.storage.put(TRANSACTION_STORAGE_KEY, this.transaction);

    // Set alarm for auto-cleanup
    await this.state.storage.setAlarm(Date.now() + TRANSACTION_TTL_MS);

    return this.transaction;
  }

  /**
   * Retrieves the current transaction state.
   * Returns null if no transaction has been created.
   */
  async get(): Promise<LoginTransaction | null> {
    return this.transaction;
  }

  /**
   * Approves a pending transaction with user information from Auth0.
   * Returns null if transaction is not pending or has expired.
   */
  async approve(userInfo: ApproveUserInfo): Promise<LoginTransaction | null> {
    // Validate user info
    this.validateFields({
      userId: userInfo.userId,
      userEmail: userInfo.userEmail,
      userName: userInfo.userName,
    });
    if (this.transaction?.status !== 'pending') {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (this.transaction.expiresAt <= now) {
      return null;
    }

    this.transaction.status = 'approved';
    this.transaction.userId = userInfo.userId;
    this.transaction.userEmail = userInfo.userEmail;
    this.transaction.userName = userInfo.userName;

    // Persist updated state
    await this.state.storage.put(TRANSACTION_STORAGE_KEY, this.transaction);

    return this.transaction;
  }

  /**
   * Redeems an approved transaction for a broker JWT.
   * Idempotent - returns the same result if called multiple times.
   * Returns null if transaction is not approved or has expired.
   */
  async redeem(): Promise<LoginTransaction | null> {
    if (!this.transaction) {
      return null;
    }

    // Idempotent - allow redeeming an already-redeemed transaction
    if (this.transaction.status === 'redeemed') {
      return this.transaction;
    }

    if (this.transaction.status !== 'approved') {
      return null;
    }

    // Enforce expiration check for consistency with approve()
    const now = Math.floor(Date.now() / 1000);
    if (this.transaction.expiresAt <= now) {
      return null;
    }

    this.transaction.status = 'redeemed';

    // Persist updated state
    await this.state.storage.put(TRANSACTION_STORAGE_KEY, this.transaction);

    // Keep for 60 more seconds to allow idempotent retries
    await this.state.storage.setAlarm(Date.now() + 60_000);

    return this.transaction;
  }

  // ===========================================================================
  // Alarm Handler
  // ===========================================================================

  /**
   * Alarm handler for automatic transaction cleanup.
   * Fires after 5 minutes (on create) or 60 seconds (on redeem).
   */
  async alarm(): Promise<void> {
    await this.initializeIfNeeded();

    // Auto-cleanup when alarm fires
    this.transaction = null;
    await this.state.storage.delete(TRANSACTION_STORAGE_KEY);
  }
}
