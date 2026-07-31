/**
 * Branch Invalidation Service Tests
 *
 * Tests for the KV-based branch invalidation signal system.
 * After a merge writes new document versions to a target branch,
 * a timestamp is written to KV. DOs poll this to detect staleness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Minimal mock of Cloudflare KV namespace
 */
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null)),
    put: vi.fn().mockImplementation((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  };
}

describe('branch-invalidation-service', () => {
  let mockKV: KVNamespace;

  beforeEach(() => {
    mockKV = createMockKV();
  });

  describe('writeBranchInvalidation', () => {
    it('should write a timestamp to the KV key branch-version:{branchId}', async () => {
      const { writeBranchInvalidation } = await import(
        '../../src/services/branch-invalidation-service'
      );

      const branchId = 'branch-abc-123';
      await writeBranchInvalidation(mockKV, branchId);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockKV.put).toHaveBeenCalledTimes(1);
      const [key, value] = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(key).toBe('branch-version:branch-abc-123');
      // Value should be a numeric timestamp string
      const ts = Number(value);
      expect(Number.isNaN(ts)).toBe(false);
      expect(ts).toBeGreaterThan(0);
    });

    it('should write a value close to Date.now()', async () => {
      const { writeBranchInvalidation } = await import(
        '../../src/services/branch-invalidation-service'
      );

      const before = Date.now();
      await writeBranchInvalidation(mockKV, 'branch-1');
      const after = Date.now();

      const [, value] = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls[0];
      const ts = Number(value);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('should not read before writing (no get call)', async () => {
      const { writeBranchInvalidation } = await import(
        '../../src/services/branch-invalidation-service'
      );

      await writeBranchInvalidation(mockKV, 'branch-1');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockKV.get).not.toHaveBeenCalled();
    });
  });

  describe('getBranchVersion', () => {
    it('should return 0 when no key exists', async () => {
      const { getBranchVersion } = await import(
        '../../src/services/branch-invalidation-service'
      );

      const version = await getBranchVersion(mockKV, 'nonexistent-branch');
      expect(version).toBe(0);
    });

    it('should return the stored timestamp as a number', async () => {
      const { getBranchVersion } = await import(
        '../../src/services/branch-invalidation-service'
      );

      // Pre-populate KV
      await (mockKV as unknown as { put: (k: string, v: string) => Promise<void> }).put(
        'branch-version:branch-1',
        '1710000000000',
      );

      const version = await getBranchVersion(mockKV, 'branch-1');
      expect(version).toBe(1710000000000);
    });

    it('should return 0 for non-numeric stored values', async () => {
      const { getBranchVersion } = await import(
        '../../src/services/branch-invalidation-service'
      );

      await (mockKV as unknown as { put: (k: string, v: string) => Promise<void> }).put(
        'branch-version:branch-1',
        'garbage',
      );

      const version = await getBranchVersion(mockKV, 'branch-1');
      expect(version).toBe(0);
    });

    it('should use independent keys per branch', async () => {
      const { writeBranchInvalidation, getBranchVersion } = await import(
        '../../src/services/branch-invalidation-service'
      );

      await writeBranchInvalidation(mockKV, 'branch-a');
      await writeBranchInvalidation(mockKV, 'branch-b');

      // Both should have values
      const versionA = await getBranchVersion(mockKV, 'branch-a');
      const versionB = await getBranchVersion(mockKV, 'branch-b');
      expect(versionA).toBeGreaterThan(0);
      expect(versionB).toBeGreaterThan(0);

      // Nonexistent branch should be 0
      const versionC = await getBranchVersion(mockKV, 'branch-c');
      expect(versionC).toBe(0);
    });
  });
});
