/**
 * Tests for branch reference resolution utility.
 *
 * Verifies that branch references (UUID or name) are correctly resolved
 * to branch UUIDs before being passed to route handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services', () => ({
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
}));

import { resolveBranchRef } from '../../src/utils/branch-ref';
import { getBranch, getBranchByName } from '../../src/services';

const SITE_ID = 'site-uuid-1234';
const OTHER_SITE_ID = 'site-uuid-9999';
const BRANCH_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('resolveBranchRef', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a UUID branchRef via getBranch with site ownership check', async () => {
    vi.mocked(getBranch).mockResolvedValue({
      id: BRANCH_UUID,
      siteId: SITE_ID,
      name: 'feature-x',
      isMain: false,
    } as never);

    const result = await resolveBranchRef(SITE_ID, BRANCH_UUID);

    expect(result).toEqual({ resolved: true, branchId: BRANCH_UUID });
    expect(getBranch).toHaveBeenCalledWith(BRANCH_UUID);
    expect(getBranchByName).not.toHaveBeenCalled();
  });

  it('rejects a UUID branch that belongs to a different site', async () => {
    vi.mocked(getBranch).mockResolvedValue({
      id: BRANCH_UUID,
      siteId: OTHER_SITE_ID,
      name: 'feature-x',
      isMain: false,
    } as never);

    const result = await resolveBranchRef(SITE_ID, BRANCH_UUID);

    expect(result).toEqual({
      resolved: false,
      error: `Branch not found: "${BRANCH_UUID}" is not a valid branch ID or name for this site`,
    });
  });

  it('returns an error when UUID branch does not exist', async () => {
    vi.mocked(getBranch).mockResolvedValue(null);

    const result = await resolveBranchRef(SITE_ID, BRANCH_UUID);

    expect(result).toEqual({
      resolved: false,
      error: `Branch not found: "${BRANCH_UUID}" is not a valid branch ID or name for this site`,
    });
  });

  it('resolves a branch name to its UUID via getBranchByName', async () => {
    vi.mocked(getBranchByName).mockResolvedValue({
      id: BRANCH_UUID,
      siteId: SITE_ID,
      name: 'feature-redesign',
      isMain: false,
    } as never);

    const result = await resolveBranchRef(SITE_ID, 'feature-redesign');

    expect(result).toEqual({ resolved: true, branchId: BRANCH_UUID });
    expect(getBranchByName).toHaveBeenCalledWith(SITE_ID, 'feature-redesign');
  });

  it('resolves "main" as a branch name', async () => {
    const mainUuid = '00000000-1111-2222-3333-444444444444';
    vi.mocked(getBranchByName).mockResolvedValue({
      id: mainUuid,
      siteId: SITE_ID,
      name: 'main',
      isMain: true,
    } as never);

    const result = await resolveBranchRef(SITE_ID, 'main');

    expect(result).toEqual({ resolved: true, branchId: mainUuid });
    expect(getBranchByName).toHaveBeenCalledWith(SITE_ID, 'main');
  });

  it('returns an error when branch name is not found', async () => {
    vi.mocked(getBranchByName).mockResolvedValue(null);

    const result = await resolveBranchRef(SITE_ID, 'nonexistent');

    expect(result).toEqual({
      resolved: false,
      error: 'Branch not found: "nonexistent" is not a valid branch ID or name for this site',
    });
  });

  it('handles uppercase UUID via getBranch lookup', async () => {
    const upper = BRANCH_UUID.toUpperCase();
    vi.mocked(getBranch).mockResolvedValue({
      id: upper,
      siteId: SITE_ID,
      name: 'feature-x',
      isMain: false,
    } as never);

    const result = await resolveBranchRef(SITE_ID, upper);

    expect(result).toEqual({ resolved: true, branchId: upper });
    expect(getBranch).toHaveBeenCalledWith(upper);
    expect(getBranchByName).not.toHaveBeenCalled();
  });

  it('treats a truncated UUID-like string as a name', async () => {
    vi.mocked(getBranchByName).mockResolvedValue(null);

    const result = await resolveBranchRef(SITE_ID, 'a1b2c3d4-e5f6');

    expect(result.resolved).toBe(false);
    expect(getBranchByName).toHaveBeenCalledWith(SITE_ID, 'a1b2c3d4-e5f6');
  });
});
