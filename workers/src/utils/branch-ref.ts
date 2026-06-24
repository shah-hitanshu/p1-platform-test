/**
 * Branch reference resolution utility.
 *
 * Resolves a branch reference (UUID or name) to a branch UUID.
 * Used by the route dispatch layer so all branch-scoped endpoints
 * accept either format transparently.
 */

import { getBranch, getBranchByName } from '../services';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BranchRefResult =
  | { resolved: true; branchId: string }
  | { resolved: false; error: string };

export async function resolveBranchRef(
  siteId: string,
  branchRef: string,
): Promise<BranchRefResult> {
  const branch = UUID_RE.test(branchRef)
    ? await getBranch(branchRef)
    : await getBranchByName(siteId, branchRef);

  if (branch?.siteId !== siteId) {
    return {
      resolved: false,
      error: `Branch not found: "${branchRef}" is not a valid branch ID or name for this site`,
    };
  }

  return { resolved: true, branchId: branch.id };
}
