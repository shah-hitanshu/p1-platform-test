import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockBranchesList = vi.fn();
const mockInitializeStores = vi.fn();

vi.mock('@pantheon-systems/css-client', () => ({
  P1Client: class MockP1Client {
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
  P1ContentClient: class MockP1ContentClient {
    getPage = vi.fn().mockResolvedValue(null);
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

  it('throws when p1BaseUrl is missing', async () => {
    await expect(
      ensureInitialized({ p1SiteId: 'site-1' }),
    ).rejects.toThrow('p1BaseUrl and p1SiteId must be set');
  });

  it('throws when p1SiteId is missing', async () => {
    await expect(
      ensureInitialized({ p1BaseUrl: 'https://api.example.com' }),
    ).rejects.toThrow('p1BaseUrl and p1SiteId must be set');
  });

  it('does not call branches.list at init when p1BranchId is omitted', async () => {
    await ensureInitialized({
      p1BaseUrl: 'https://api.example.com',
      p1SiteId: 'site-1',
    });

    // Branch detection is deferred to the first editor request so a
    // read:published sat_ token (which cannot reach the branches endpoint)
    // can still initialize the store for public SSR.
    expect(mockBranchesList).not.toHaveBeenCalled();
    expect(mockInitializeStores).toHaveBeenCalledOnce();
  });

  it('uses provided p1BranchId without listing branches', async () => {
    await ensureInitialized({
      p1BaseUrl: 'https://api.example.com',
      p1SiteId: 'site-1',
      p1BranchId: 'branch-explicit',
    });

    expect(mockBranchesList).not.toHaveBeenCalled();
    expect(mockInitializeStores).toHaveBeenCalledOnce();
  });

  it('deduplicates — calling twice returns the same promise', async () => {
    mockBranchesList.mockResolvedValue([{ id: 'branch-main', isMain: true }]);

    const config = {
      p1BaseUrl: 'https://api.example.com',
      p1SiteId: 'site-1',
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
      p1BaseUrl: 'https://api.example.com',
      p1SiteId: 'site-1',
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
      p1BaseUrl: 'https://api.example.com',
      p1SiteId: 'site-1',
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
