/**
 * An inherited version lives on main, so its diff chain has to be rebuilt
 * against main. Rebuilding it against the branch finds nothing and reports the
 * document as missing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersionWithFallback: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
}));

const { cloneLatestSnapshot } = await import('../../src/services/document-clone');
const versionService = await import('../../src/services/document-version-service');

function diffOnlyVersion(inherited: boolean): unknown {
  return { version: { versionNumber: 7, snapshot: null }, inherited };
}

describe('cloneLatestSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(versionService.reconstructVersionSnapshot).mockResolvedValue({
      root: { props: {} },
    });
  });

  it('rebuilds an inherited diff-only version against main, not the branch', async () => {
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(
      diffOnlyVersion(true) as never,
    );

    const clone = await cloneLatestSnapshot('doc-1', 'branch-1', 'main-1');

    expect(clone?.versionNumber).toBe(7);
    expect(versionService.reconstructVersionSnapshot).toHaveBeenCalledWith('doc-1', 'main-1', 7);
  });

  it('rebuilds a branch-local diff-only version against the branch', async () => {
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(
      diffOnlyVersion(false) as never,
    );

    await cloneLatestSnapshot('doc-1', 'branch-1', 'main-1');

    expect(versionService.reconstructVersionSnapshot).toHaveBeenCalledWith('doc-1', 'branch-1', 7);
  });

  it('reads the branch alone when no main is given', async () => {
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(null);

    expect(await cloneLatestSnapshot('doc-1', 'branch-1')).toBeNull();
    expect(versionService.getLatestDocumentVersionWithFallback).toHaveBeenCalledWith(
      'doc-1',
      'branch-1',
      'branch-1',
    );
  });

  it('clones rather than aliasing the stored snapshot', async () => {
    const stored = { root: { props: { title: 'About' } } };
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      version: { versionNumber: 2, snapshot: stored },
      inherited: false,
    } as never);

    const clone = await cloneLatestSnapshot('doc-1', 'branch-1');
    (clone?.snapshot.root as { props: { title: string } }).props.title = 'Changed';

    expect(stored.root.props.title).toBe('About');
    expect(versionService.reconstructVersionSnapshot).not.toHaveBeenCalled();
  });
});
