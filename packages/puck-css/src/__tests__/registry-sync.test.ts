// @vitest-environment node
/**
 * registry-sync.ts subpath export — identity check
 *
 * Confirms the new subpath entry re-exports the same function/type
 * identities as the underlying modules, not copies or re-implementations.
 */

import { describe, it, expect } from 'vitest';

describe('registry-sync subpath export', () => {
  it('re-exports the same syncComponentRegistry function as the source module', async () => {
    const subpath = await import('../registry-sync.js');
    const source = await import('../editor/utils/syncComponentRegistry.js');
    expect(subpath.syncComponentRegistry).toBe(source.syncComponentRegistry);
  });

  it('re-exports the same extractDescriptors/buildRegistryIndex functions as componentRegistry.js', async () => {
    const subpath = await import('../registry-sync.js');
    const source = await import('../editor/utils/componentRegistry.js');
    expect(subpath.extractDescriptors).toBe(source.extractDescriptors);
    expect(subpath.buildRegistryIndex).toBe(source.buildRegistryIndex);
  });

  it('does not re-export P1Client or ConflictError', async () => {
    const subpath = await import('../registry-sync.js');
    expect('P1Client' in subpath).toBe(false);
    expect('ConflictError' in subpath).toBe(false);
  });
});
