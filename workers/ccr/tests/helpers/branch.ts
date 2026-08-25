import type { Branch } from '../../src/types';

/**
 * Builds a `Branch` for a handler or service under test.
 *
 * Tests care about `id`, `siteId`, `name` and `isMain`; the timestamps and
 * attribution columns are bookkeeping every fixture would otherwise repeat.
 */
export function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: 'branch-1',
    siteId: 'site-1',
    name: 'main',
    status: 'active',
    isMain: true,
    createdById: 'user-1',
    createdByType: 'user',
    createdAt: '2026-01-24T10:00:00.000Z',
    updatedAt: '2026-01-24T10:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}
