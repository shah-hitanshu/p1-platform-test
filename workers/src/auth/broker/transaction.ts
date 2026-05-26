/**
 * Broker Login Transaction
 *
 * Manages short-lived login transactions stored in Cloudflare KV.
 * A transaction is created when a panel initiates a login (via sat_ token),
 * approved when the user authenticates via Auth0, and redeemed when the
 * panel exchanges the transaction for a broker-issued JWT.
 *
 * Transactions are single-use and auto-expire after 5 minutes via KV TTL.
 */

const KV_PREFIX = 'broker_tx:';
const TRANSACTION_TTL_SECONDS = 300;

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

// =============================================================================
// Functions
// =============================================================================

export async function createTransaction(
  kv: KVNamespace,
  siteId: string,
  siteApiTokenId: string,
  options?: { redirectUrl?: string; prompt?: string },
): Promise<LoginTransaction> {
  const now = Math.floor(Date.now() / 1000);
  const tx: LoginTransaction = {
    id: crypto.randomUUID(),
    siteId,
    siteApiTokenId,
    status: 'pending',
    createdAt: now,
    expiresAt: now + TRANSACTION_TTL_SECONDS,
    ...(options?.redirectUrl !== undefined ? { redirectUrl: options.redirectUrl } : {}),
    ...(options?.prompt !== undefined ? { prompt: options.prompt } : {}),
  };

  await kv.put(
    `${KV_PREFIX}${tx.id}`,
    JSON.stringify(tx),
    { expirationTtl: TRANSACTION_TTL_SECONDS },
  );

  return tx;
}

export async function getTransaction(
  kv: KVNamespace,
  id: string,
): Promise<LoginTransaction | null> {
  const raw = await kv.get(`${KV_PREFIX}${id}`);
  if (raw === null) {
    return null;
  }

  return JSON.parse(raw) as LoginTransaction;
}

export async function approveTransaction(
  kv: KVNamespace,
  id: string,
  userInfo: ApproveUserInfo,
): Promise<LoginTransaction | null> {
  const tx = await getTransaction(kv, id);
  if (tx?.status !== 'pending') {
    return null;
  }

  tx.status = 'approved';
  tx.userId = userInfo.userId;
  tx.userEmail = userInfo.userEmail;
  tx.userName = userInfo.userName;

  const remainingTtl = tx.expiresAt - Math.floor(Date.now() / 1000);
  if (remainingTtl <= 0) {
    return null;
  }

  await kv.put(
    `${KV_PREFIX}${id}`,
    JSON.stringify(tx),
    { expirationTtl: remainingTtl },
  );

  return tx;
}

export async function redeemTransaction(
  kv: KVNamespace,
  id: string,
): Promise<LoginTransaction | null> {
  const tx = await getTransaction(kv, id);
  if (tx?.status !== 'approved') {
    return null;
  }

  tx.status = 'redeemed';

  await kv.delete(`${KV_PREFIX}${id}`);

  return tx;
}
