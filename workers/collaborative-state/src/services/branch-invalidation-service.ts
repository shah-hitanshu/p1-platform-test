/**
 * Branch Invalidation Service
 *
 * Manages KV-based invalidation signals for branch state changes.
 * After a merge writes new document versions to a target branch,
 * the caller writes a timestamp to KV. Durable Objects poll this
 * timestamp to detect when they need to reload from PostgreSQL.
 *
 * Key format: `branch-version:{branchId}`
 * Value format: numeric timestamp string (Date.now())
 */

/** KV key prefix for branch invalidation timestamps */
const BRANCH_VERSION_PREFIX = 'branch-version:';

/**
 * Write a branch invalidation signal to KV.
 *
 * Writes the current timestamp as the branch version.
 * No read-before-write is needed — concurrent writes both
 * produce a recent timestamp, and the DO will reload regardless
 * of which one "wins."
 *
 * @param kv - The KV namespace to write to (CONFIG_KV)
 * @param branchId - The branch that was modified (merge target)
 */
export async function writeBranchInvalidation(
  kv: KVNamespace,
  branchId: string,
): Promise<void> {
  const key = `${BRANCH_VERSION_PREFIX}${branchId}`;
  await kv.put(key, Date.now().toString());
}

/**
 * Read the current branch version (invalidation timestamp) from KV.
 *
 * Returns 0 if no key exists or the value is not a valid number.
 * DOs compare this against their last-seen version to detect staleness.
 *
 * @param kv - The KV namespace to read from (CONFIG_KV)
 * @param branchId - The branch to check
 * @returns The stored timestamp, or 0 if none exists
 */
export async function getBranchVersion(
  kv: KVNamespace,
  branchId: string,
): Promise<number> {
  const key = `${BRANCH_VERSION_PREFIX}${branchId}`;
  const value = await kv.get(key);
  if (value === null) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
