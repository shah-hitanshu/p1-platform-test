import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockBranchesList = vi.fn();
const mockInitializeStores = vi.fn();

vi.mock('@pantheon-systems/css-client', () => ({
  CSSClient: class MockCSSClient {
    branches = { list: mockBranchesList };
    documents = {
      list: vi.fn().mockResolvedValue([]),
      getByPath: vi.fn().mockRejectedValue(new Error('not found')),
      create: vi.fn().mockResolvedValue({ id: 'doc-1', path: 'test' }),
      delete: vi.fn(),
    };
    versions = {
      getLatest: vi.fn().mockResolvedValue({ snapshot: {} }),
      create: vi.fn(),
    };
  },
}));

vi.mock('../../data/dal/index', () => ({
  initializeStores: (...args: unknown[]) => mockInitializeStores(...args),
}));

import { ensureInitialized, _resetInit } from '../../data/dal/init';

describe('ensureInitialized', () => {
  beforeEach(() => {
    _resetInit();
    mockBranchesList.mockReset();
    mockInitializeStores.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when cssBaseUrl is missing', async () => {
    await expect(
      ensureInitialized({ cssSiteId: 'site-1' }),
    ).rejects.toThrow('cssBaseUrl and cssSiteId must be set');
  });

  it('throws when cssSiteId is missing', async () => {
    await expect(
      ensureInitialized({ cssBaseUrl: 'https://api.example.com' }),
    ).rejects.toThrow('cssBaseUrl and cssSiteId must be set');
  });

  it('auto-detects main branch when cssBranchId is omitted', async () => {
    mockBranchesList.mockResolvedValue([
      { id: 'branch-dev', isMain: false },
      { id: 'branch-main', isMain: true },
    ]);

    await ensureInitialized({
      cssBaseUrl: 'https://api.example.com',
      cssSiteId: 'site-1',
    });

    expect(mockBranchesList).toHaveBeenCalledWith('site-1');
    expect(mockInitializeStores).toHaveBeenCalledOnce();
  });

  it('throws when no main branch found', async () => {
    mockBranchesList.mockResolvedValue([
      { id: 'branch-dev', isMain: false },
    ]);

    // Need to reset since the previous test may have cached a promise
    _resetInit();

    await expect(
      ensureInitialized({
        cssBaseUrl: 'https://api.example.com',
        cssSiteId: 'site-1',
      }),
    ).rejects.toThrow('No main branch found');
  });

  it('uses provided cssBranchId without listing branches', async () => {
    await ensureInitialized({
      cssBaseUrl: 'https://api.example.com',
      cssSiteId: 'site-1',
      cssBranchId: 'branch-explicit',
    });

    expect(mockBranchesList).not.toHaveBeenCalled();
    expect(mockInitializeStores).toHaveBeenCalledOnce();
  });

  it('deduplicates — calling twice returns the same promise', async () => {
    mockBranchesList.mockResolvedValue([{ id: 'branch-main', isMain: true }]);

    const config = {
      cssBaseUrl: 'https://api.example.com',
      cssSiteId: 'site-1',
    };

    const p1 = ensureInitialized(config);
    const p2 = ensureInitialized(config);
    expect(p1).toBe(p2);

    await p1;
    expect(mockInitializeStores).toHaveBeenCalledOnce();
  });

  it('re-initializes after _resetInit()', async () => {
    mockBranchesList.mockResolvedValue([{ id: 'branch-main', isMain: true }]);

    const config = {
      cssBaseUrl: 'https://api.example.com',
      cssSiteId: 'site-1',
    };

    await ensureInitialized(config);
    expect(mockInitializeStores).toHaveBeenCalledOnce();

    _resetInit();

    await ensureInitialized(config);
    expect(mockInitializeStores).toHaveBeenCalledTimes(2);
  });

  it('calls initializeStores with pageStore, editorMetaStore, and remoteDatasourceDefStore', async () => {
    mockBranchesList.mockResolvedValue([{ id: 'branch-main', isMain: true }]);

    await ensureInitialized({
      cssBaseUrl: 'https://api.example.com',
      cssSiteId: 'site-1',
    });

    expect(mockInitializeStores).toHaveBeenCalledWith(
      expect.objectContaining({
        pageStore: expect.objectContaining({
          get: expect.any(Function),
          set: expect.any(Function),
          delete: expect.any(Function),
          has: expect.any(Function),
          keys: expect.any(Function),
        }),
        editorMetaStore: expect.objectContaining({
          get: expect.any(Function),
          set: expect.any(Function),
          delete: expect.any(Function),
        }),
        remoteDatasourceDefStore: expect.objectContaining({
          list: expect.any(Function),
          save: expect.any(Function),
        }),
      }),
    );
  });
});
